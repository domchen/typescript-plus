/// <reference path="..\compiler\commandLineParser.ts" />
/// <reference path="..\services\services.ts" />
/// <reference path="protocol.ts" />
/// <reference path="editorServices.ts" />

namespace ts.server {
    interface StackTraceError extends Error {
        stack?: string;
    }

    export interface ServerCancellationToken extends HostCancellationToken {
        setRequest(requestId: number): void;
        resetRequest(requestId: number): void;
    }

    export const nullCancellationToken: ServerCancellationToken = {
        isCancellationRequested: () => false,
        setRequest: () => void 0,
        resetRequest: () => void 0
    };

    function hrTimeToMilliseconds(time: number[]): number {
        const seconds = time[0];
        const nanoseconds = time[1];
        return ((1e9 * seconds) + nanoseconds) / 1000000.0;
    }

    function isDeclarationFileInJSOnlyNonConfiguredProject(project: Project, file: NormalizedPath) {
        // Checking for semantic diagnostics is an expensive process. We want to avoid it if we
        // know for sure it is not needed.
        // For instance, .d.ts files injected by ATA automatically do not produce any relevant
        // errors to a JS- only project.
        //
        // Note that configured projects can set skipLibCheck (on by default in jsconfig.json) to
        // disable checking for declaration files. We only need to verify for inferred projects (e.g.
        // miscellaneous context in VS) and external projects(e.g.VS.csproj project) with only JS
        // files.
        //
        // We still want to check .js files in a JS-only inferred or external project (e.g. if the
        // file has '// @ts-check').

        if ((project.projectKind === ProjectKind.Inferred || project.projectKind === ProjectKind.External) &&
            project.isJsOnlyProject()) {
            const scriptInfo = project.getScriptInfoForNormalizedPath(file);
            return scriptInfo && !scriptInfo.isJavaScript();
        }
        return false;
    }

    interface FileStart {
        file: string;
        start: protocol.Location;
    }

    function compareNumber(a: number, b: number) {
        return a - b;
    }

    function compareFileStart(a: FileStart, b: FileStart) {
        if (a.file < b.file) {
            return -1;
        }
        else if (a.file === b.file) {
            const n = compareNumber(a.start.line, b.start.line);
            if (n === 0) {
                return compareNumber(a.start.offset, b.start.offset);
            }
            else return n;
        }
        else {
            return 1;
        }
    }

    function formatDiag(fileName: NormalizedPath, project: Project, diag: Diagnostic): protocol.Diagnostic {
        const scriptInfo = project.getScriptInfoForNormalizedPath(fileName);
        return {
            start: scriptInfo.positionToLineOffset(diag.start),
            end: scriptInfo.positionToLineOffset(diag.start + diag.length),
            text: flattenDiagnosticMessageText(diag.messageText, "\n"),
            code: diag.code,
            category: DiagnosticCategory[diag.category].toLowerCase(),
            source: diag.source
        };
    }

    function convertToLocation(lineAndCharacter: LineAndCharacter): protocol.Location {
        return { line: lineAndCharacter.line + 1, offset: lineAndCharacter.character + 1 };
    }

    function formatConfigFileDiag(diag: Diagnostic, includeFileName: true): protocol.DiagnosticWithFileName;
    function formatConfigFileDiag(diag: Diagnostic, includeFileName: false): protocol.Diagnostic;
    function formatConfigFileDiag(diag: Diagnostic, includeFileName: boolean): protocol.Diagnostic | protocol.DiagnosticWithFileName {
        const start = diag.file && convertToLocation(getLineAndCharacterOfPosition(diag.file, diag.start));
        const end = diag.file && convertToLocation(getLineAndCharacterOfPosition(diag.file, diag.start + diag.length));
        const text = flattenDiagnosticMessageText(diag.messageText, "\n");
        const { code, source } = diag;
        const category = DiagnosticCategory[diag.category].toLowerCase();
        return includeFileName ? { start, end, text, code, category, source, fileName: diag.file && diag.file.fileName } :
            { start, end, text, code, category, source };
    }

    export interface PendingErrorCheck {
        fileName: NormalizedPath;
        project: Project;
    }

    function allEditsBeforePos(edits: ts.TextChange[], pos: number) {
        for (const edit of edits) {
            if (textSpanEnd(edit.span) >= pos) {
                return false;
            }
        }
        return true;
    }

    // CommandNames used to be exposed before TS 2.4 as a namespace
    // In TS 2.4 we switched to an enum, keep this for backward compatibility
    // The var assignment ensures that even though CommandTypes are a const enum
    // we want to ensure the value is maintained in the out since the file is
    // built using --preseveConstEnum.
    export type CommandNames = protocol.CommandTypes;
    export const CommandNames = (<any>protocol).CommandTypes; // tslint:disable-line variable-name

    export function formatMessage<T extends protocol.Message>(msg: T, logger: server.Logger, byteLength: (s: string, encoding: string) => number, newLine: string): string {
        const verboseLogging = logger.hasLevel(LogLevel.verbose);

        const json = JSON.stringify(msg);
        if (verboseLogging) {
            logger.info(`${msg.type}:${indent(json)}`);
        }

        const len = byteLength(json, "utf8");
        return `Content-Length: ${1 + len}\r\n\r\n${json}${newLine}`;
    }

    /**
     * Allows to schedule next step in multistep operation
     */
    interface NextStep {
        immediate(action: () => void): void;
        delay(ms: number, action: () => void): void;
    }

    /**
     * External capabilities used by multistep operation
     */
    interface MultistepOperationHost {
        getCurrentRequestId(): number;
        sendRequestCompletedEvent(requestId: number): void;
        getServerHost(): ServerHost;
        isCancellationRequested(): boolean;
        executeWithRequestId(requestId: number, action: () => void): void;
        logError(error: Error, message: string): void;
    }

    /**
     * Represents operation that can schedule its next step to be executed later.
     * Scheduling is done via instance of NextStep. If on current step subsequent step was not scheduled - operation is assumed to be completed.
     */
    class MultistepOperation implements NextStep {
        private requestId: number | undefined;
        private timerHandle: any;
        private immediateId: number | undefined;

        constructor(private readonly operationHost: MultistepOperationHost) { }

        public startNew(action: (next: NextStep) => void) {
            this.complete();
            this.requestId = this.operationHost.getCurrentRequestId();
            this.executeAction(action);
        }

        private complete() {
            if (this.requestId !== undefined) {
                this.operationHost.sendRequestCompletedEvent(this.requestId);
                this.requestId = undefined;
            }
            this.setTimerHandle(undefined);
            this.setImmediateId(undefined);
        }

        public immediate(action: () => void) {
            const requestId = this.requestId;
            Debug.assert(requestId === this.operationHost.getCurrentRequestId(), "immediate: incorrect request id");
            this.setImmediateId(this.operationHost.getServerHost().setImmediate(() => {
                this.immediateId = undefined;
                this.operationHost.executeWithRequestId(requestId, () => this.executeAction(action));
            }));
        }

        public delay(ms: number, action: () => void) {
            const requestId = this.requestId;
            Debug.assert(requestId === this.operationHost.getCurrentRequestId(), "delay: incorrect request id");
            this.setTimerHandle(this.operationHost.getServerHost().setTimeout(() => {
                this.timerHandle = undefined;
                this.operationHost.executeWithRequestId(requestId, () => this.executeAction(action));
            }, ms));
        }

        private executeAction(action: (next: NextStep) => void) {
            let stop = false;
            try {
                if (this.operationHost.isCancellationRequested()) {
                    stop = true;
                }
                else {
                    action(this);
                }
            }
            catch (e) {
                stop = true;
                // ignore cancellation request
                if (!(e instanceof OperationCanceledException)) {
                    this.operationHost.logError(e, `delayed processing of request ${this.requestId}`);
                }
            }
            if (stop || !this.hasPendingWork()) {
                this.complete();
            }
        }

        private setTimerHandle(timerHandle: any) {
            if (this.timerHandle !== undefined) {
                this.operationHost.getServerHost().clearTimeout(this.timerHandle);
            }
            this.timerHandle = timerHandle;
        }

        private setImmediateId(immediateId: number) {
            if (this.immediateId !== undefined) {
                this.operationHost.getServerHost().clearImmediate(this.immediateId);
            }
            this.immediateId = immediateId;
        }

        private hasPendingWork() {
            return !!this.timerHandle || !!this.immediateId;
        }
    }

    export type Event = <T extends object>(body: T, eventName: string) => void;

    export interface EventSender {
        event: Event;
    }

    /** @internal */
    export function toEvent(eventName: string, body: object): protocol.Event {
        return {
            seq: 0,
            type: "event",
            event: eventName,
            body
        };
    }

    type Projects = ReadonlyArray<Project> | {
        projects: ReadonlyArray<Project>;
        symLinkedProjects: MultiMap<Project>;
    };

    function isProjectsArray(projects: Projects): projects is ReadonlyArray<Project> {
        return !!(<ReadonlyArray<Project>>projects).length;
    }

    /**
     * This helper function processes a list of projects and return the concatenated, sortd and deduplicated output of processing each project.
     */
    function combineProjectOutput<T, U>(defaultValue: T, getValue: (path: Path) => T, projects: Projects, action: (project: Project, value: T) => ReadonlyArray<U> | U | undefined, comparer?: (a: U, b: U) => number, areEqual?: (a: U, b: U) => boolean) {
        const outputs = flatMap(isProjectsArray(projects) ? projects : projects.projects, project => action(project, defaultValue));
        if (!isProjectsArray(projects) && projects.symLinkedProjects) {
            projects.symLinkedProjects.forEach((projects, path) => {
                const value = getValue(path as Path);
                outputs.push(...flatMap(projects, project => action(project, value)));
            });
        }

        return comparer
            ? sortAndDeduplicate(outputs, comparer, areEqual)
            : deduplicate(outputs, areEqual);
    }

    export interface SessionOptions {
        host: ServerHost;
        cancellationToken: ServerCancellationToken;
        useSingleInferredProject: boolean;
        useInferredProjectPerProjectRoot: boolean;
        typingsInstaller: ITypingsInstaller;
        byteLength: (buf: string, encoding?: string) => number;
        hrtime: (start?: number[]) => number[];
        logger: Logger;
        /**
         * If falsy, all events are suppressed.
         */
        canUseEvents: boolean;
        eventHandler?: ProjectServiceEventHandler;
        throttleWaitMilliseconds?: number;

        globalPlugins?: ReadonlyArray<string>;
        pluginProbeLocations?: ReadonlyArray<string>;
        allowLocalPluginLoads?: boolean;
    }

    export class Session implements EventSender {
        private readonly gcTimer: GcTimer;
        protected projectService: ProjectService;
        private changeSeq = 0;

        private currentRequestId: number;
        private errorCheck: MultistepOperation;

        protected host: ServerHost;
        private readonly cancellationToken: ServerCancellationToken;
        protected readonly typingsInstaller: ITypingsInstaller;
        protected byteLength: (buf: string, encoding?: string) => number;
        private hrtime: (start?: number[]) => number[];
        protected logger: Logger;

        protected canUseEvents: boolean;
        private eventHandler: ProjectServiceEventHandler;

        constructor(opts: SessionOptions) {
            this.host = opts.host;
            this.cancellationToken = opts.cancellationToken;
            this.typingsInstaller = opts.typingsInstaller;
            this.byteLength = opts.byteLength;
            this.hrtime = opts.hrtime;
            this.logger = opts.logger;
            this.canUseEvents = opts.canUseEvents;

            const { throttleWaitMilliseconds } = opts;

            this.eventHandler = this.canUseEvents
                ? opts.eventHandler || (event => this.defaultEventHandler(event))
                : undefined;
            const multistepOperationHost: MultistepOperationHost = {
                executeWithRequestId: (requestId, action) => this.executeWithRequestId(requestId, action),
                getCurrentRequestId: () => this.currentRequestId,
                getServerHost: () => this.host,
                logError: (err, cmd) => this.logError(err, cmd),
                sendRequestCompletedEvent: requestId => this.sendRequestCompletedEvent(requestId),
                isCancellationRequested: () => this.cancellationToken.isCancellationRequested()
            };
            this.errorCheck = new MultistepOperation(multistepOperationHost);
            const settings: ProjectServiceOptions = {
                host: this.host,
                logger: this.logger,
                cancellationToken: this.cancellationToken,
                useSingleInferredProject: opts.useSingleInferredProject,
                useInferredProjectPerProjectRoot: opts.useInferredProjectPerProjectRoot,
                typingsInstaller: this.typingsInstaller,
                throttleWaitMilliseconds,
                eventHandler: this.eventHandler,
                globalPlugins: opts.globalPlugins,
                pluginProbeLocations: opts.pluginProbeLocations,
                allowLocalPluginLoads: opts.allowLocalPluginLoads
            };
            this.projectService = new ProjectService(settings);
            this.gcTimer = new GcTimer(this.host, /*delay*/ 7000, this.logger);
        }

        private sendRequestCompletedEvent(requestId: number): void {
            this.event<protocol.RequestCompletedEventBody>({ request_seq: requestId }, "requestCompleted");
        }

        private defaultEventHandler(event: ProjectServiceEvent) {
            switch (event.eventName) {
                case ProjectsUpdatedInBackgroundEvent:
                    const { openFiles } = event.data;
                    this.projectsUpdatedInBackgroundEvent(openFiles);
                    break;
                case ConfigFileDiagEvent:
                    const { triggerFile, configFileName: configFile, diagnostics } = event.data;
                    const bakedDiags = map(diagnostics, diagnostic => formatConfigFileDiag(diagnostic, /*includeFileName*/ true));
                    this.event<protocol.ConfigFileDiagnosticEventBody>({
                        triggerFile,
                        configFile,
                        diagnostics: bakedDiags
                    }, "configFileDiag");
                    break;
                case ProjectLanguageServiceStateEvent: {
                    const eventName: protocol.ProjectLanguageServiceStateEventName = "projectLanguageServiceState";
                    this.event<protocol.ProjectLanguageServiceStateEventBody>({
                        projectName: event.data.project.getProjectName(),
                        languageServiceEnabled: event.data.languageServiceEnabled
                    }, eventName);
                    break;
                }
                case ProjectInfoTelemetryEvent: {
                    const eventName: protocol.TelemetryEventName = "telemetry";
                    this.event<protocol.TelemetryEventBody>({
                        telemetryEventName: event.eventName,
                        payload: event.data,
                    }, eventName);
                    break;
                }
            }
        }

        private projectsUpdatedInBackgroundEvent(openFiles: string[]): void {
            this.projectService.logger.info(`got projects updated in background, updating diagnostics for ${openFiles}`);
            if (openFiles.length) {
                const checkList = this.createCheckList(openFiles);

                // For now only queue error checking for open files. We can change this to include non open files as well
                this.errorCheck.startNew(next => this.updateErrorCheck(next, checkList, 100, /*requireOpen*/ true));


                // Send project changed event
                this.event<protocol.ProjectsUpdatedInBackgroundEventBody>({
                    openFiles
                }, "projectsUpdatedInBackground");
            }
        }

        public logError(err: Error, cmd: string) {
            let msg = "Exception on executing command " + cmd;
            if (err.message) {
                msg += ":\n" + indent(err.message);
                if ((<StackTraceError>err).stack) {
                    msg += "\n" + indent((<StackTraceError>err).stack);
                }
            }
            this.logger.msg(msg, Msg.Err);
        }

        public send(msg: protocol.Message) {
            if (msg.type === "event" && !this.canUseEvents) {
                if (this.logger.hasLevel(LogLevel.verbose)) {
                    this.logger.info(`Session does not support events: ignored event: ${JSON.stringify(msg)}`);
                }
                return;
            }
            this.host.write(formatMessage(msg, this.logger, this.byteLength, this.host.newLine));
        }

        public event<T extends object>(body: T, eventName: string): void {
            this.send(toEvent(eventName, body));
        }

        // For backwards-compatibility only.
        /** @deprecated */
        public output(info: any, cmdName: string, reqSeq?: number, errorMsg?: string): void {
            this.doOutput(info, cmdName, reqSeq, /*success*/ !errorMsg, errorMsg);
        }

        private doOutput(info: {} | undefined, cmdName: string, reqSeq: number, success: boolean, message?: string): void {
            const res: protocol.Response = {
                seq: 0,
                type: "response",
                command: cmdName,
                request_seq: reqSeq,
                success,
            };
            if (success) {
                res.body = info;
            }
            else {
                Debug.assert(info === undefined);
            }
            if (message) {
                res.message = message;
            }
            this.send(res);
        }

        private semanticCheck(file: NormalizedPath, project: Project) {
            try {
                let diags: ReadonlyArray<Diagnostic> = emptyArray;
                if (!isDeclarationFileInJSOnlyNonConfiguredProject(project, file)) {
                    diags = project.getLanguageService().getSemanticDiagnostics(file);
                }

                const bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
                this.event<protocol.DiagnosticEventBody>({ file, diagnostics: bakedDiags }, "semanticDiag");
            }
            catch (err) {
                this.logError(err, "semantic check");
            }
        }

        private syntacticCheck(file: NormalizedPath, project: Project) {
            try {
                const diags = project.getLanguageService().getSyntacticDiagnostics(file);
                if (diags) {
                    const bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
                    this.event<protocol.DiagnosticEventBody>({ file, diagnostics: bakedDiags }, "syntaxDiag");
                }
            }
            catch (err) {
                this.logError(err, "syntactic check");
            }
        }

        private updateErrorCheck(next: NextStep, checkList: PendingErrorCheck[], ms: number, requireOpen = true) {
            const seq = this.changeSeq;
            const followMs = Math.min(ms, 200);

            let index = 0;
            const checkOne = () => {
                if (this.changeSeq === seq) {
                    const checkSpec = checkList[index];
                    index++;
                    if (checkSpec.project.containsFile(checkSpec.fileName, requireOpen)) {
                        this.syntacticCheck(checkSpec.fileName, checkSpec.project);
                        if (this.changeSeq === seq) {
                            next.immediate(() => {
                                this.semanticCheck(checkSpec.fileName, checkSpec.project);
                                if (checkList.length > index) {
                                    next.delay(followMs, checkOne);
                                }
                            });
                        }
                    }
                }
            };

            if (checkList.length > index && this.changeSeq === seq) {
                next.delay(ms, checkOne);
            }
        }

        private cleanProjects(caption: string, projects: Project[]) {
            if (!projects) {
                return;
            }
            this.logger.info(`cleaning ${caption}`);
            for (const p of projects) {
                p.getLanguageService(/*ensureSynchronized*/ false).cleanupSemanticCache();
            }
        }

        private cleanup() {
            this.cleanProjects("inferred projects", this.projectService.inferredProjects);
            this.cleanProjects("configured projects", arrayFrom(this.projectService.configuredProjects.values()));
            this.cleanProjects("external projects", this.projectService.externalProjects);
            if (this.host.gc) {
                this.logger.info(`host.gc()`);
                this.host.gc();
            }
        }

        private getEncodedSemanticClassifications(args: protocol.EncodedSemanticClassificationsRequestArgs) {
            const { file, project } = this.getFileAndProject(args);
            return project.getLanguageService().getEncodedSemanticClassifications(file, args);
        }

        private getProject(projectFileName: string) {
            return projectFileName && this.projectService.findProject(projectFileName);
        }

        private getConfigFileAndProject(args: protocol.FileRequestArgs) {
            const project = this.getProject(args.projectFileName);
            const file = toNormalizedPath(args.file);

            return {
                configFile: project && project.hasConfigFile(file) && file,
                project
            };
        }

        private getConfigFileDiagnostics(configFile: NormalizedPath, project: Project, includeLinePosition: boolean) {
            const projectErrors = project.getAllProjectErrors();
            const optionsErrors = project.getLanguageService().getCompilerOptionsDiagnostics();
            const diagnosticsForConfigFile = filter(
                concatenate(projectErrors, optionsErrors),
                diagnostic => diagnostic.file && diagnostic.file.fileName === configFile
            );
            return includeLinePosition ?
                this.convertToDiagnosticsWithLinePositionFromDiagnosticFile(diagnosticsForConfigFile) :
                map(
                    diagnosticsForConfigFile,
                    diagnostic => formatConfigFileDiag(diagnostic, /*includeFileName*/ false)
                );
        }

        private convertToDiagnosticsWithLinePositionFromDiagnosticFile(diagnostics: ReadonlyArray<Diagnostic>): protocol.DiagnosticWithLinePosition[] {
            return diagnostics.map<protocol.DiagnosticWithLinePosition>(d => ({
                message: flattenDiagnosticMessageText(d.messageText, this.host.newLine),
                start: d.start,
                length: d.length,
                category: DiagnosticCategory[d.category].toLowerCase(),
                code: d.code,
                startLocation: d.file && convertToLocation(getLineAndCharacterOfPosition(d.file, d.start)),
                endLocation: d.file && convertToLocation(getLineAndCharacterOfPosition(d.file, d.start + d.length))
            }));
        }

        private getCompilerOptionsDiagnostics(args: protocol.CompilerOptionsDiagnosticsRequestArgs) {
            const project = this.getProject(args.projectFileName);
            // Get diagnostics that dont have associated file with them
            // The diagnostics which have file would be in config file and
            // would be reported as part of configFileDiagnostics
            return this.convertToDiagnosticsWithLinePosition(
                filter(
                    project.getLanguageService().getCompilerOptionsDiagnostics(),
                    diagnostic => !diagnostic.file
                ),
                /*scriptInfo*/ undefined
            );
        }

        private convertToDiagnosticsWithLinePosition(diagnostics: ReadonlyArray<Diagnostic>, scriptInfo: ScriptInfo): protocol.DiagnosticWithLinePosition[] {
            return diagnostics.map(d => <protocol.DiagnosticWithLinePosition>{
                message: flattenDiagnosticMessageText(d.messageText, this.host.newLine),
                start: d.start,
                length: d.length,
                category: DiagnosticCategory[d.category].toLowerCase(),
                code: d.code,
                source: d.source,
                startLocation: scriptInfo && scriptInfo.positionToLineOffset(d.start),
                endLocation: scriptInfo && scriptInfo.positionToLineOffset(d.start + d.length)
            });
        }

        private getDiagnosticsWorker(
            args: protocol.FileRequestArgs, isSemantic: boolean, selector: (project: Project, file: string) => ReadonlyArray<Diagnostic>, includeLinePosition: boolean
        ): ReadonlyArray<protocol.DiagnosticWithLinePosition> | ReadonlyArray<protocol.Diagnostic> {
            const { project, file } = this.getFileAndProject(args);
            if (isSemantic && isDeclarationFileInJSOnlyNonConfiguredProject(project, file)) {
                return emptyArray;
            }
            const scriptInfo = project.getScriptInfoForNormalizedPath(file);
            const diagnostics = selector(project, file);
            return includeLinePosition
                ? this.convertToDiagnosticsWithLinePosition(diagnostics, scriptInfo)
                : diagnostics.map(d => formatDiag(file, project, d));
        }

        private getDefinition(args: protocol.FileLocationRequestArgs, simplifiedResult: boolean): ReadonlyArray<protocol.FileSpan> | ReadonlyArray<DefinitionInfo> {
            const { file, project } = this.getFileAndProject(args);
            const position = this.getPositionInFile(args, file);

            const definitions = project.getLanguageService().getDefinitionAtPosition(file, position);
            if (!definitions) {
                return emptyArray;
            }

            if (simplifiedResult) {
                return this.mapDefinitionInfo(definitions, project);
            }
            else {
                return definitions;
            }
        }

        private getDefinitionAndBoundSpan(args: protocol.FileLocationRequestArgs, simplifiedResult: boolean): protocol.DefinitionInfoAndBoundSpan | DefinitionInfoAndBoundSpan {
            const { file, project } = this.getFileAndProject(args);
            const position = this.getPositionInFile(args, file);
            const scriptInfo = project.getScriptInfo(file);

            const definitionAndBoundSpan = project.getLanguageService().getDefinitionAndBoundSpan(file, position);

            if (!definitionAndBoundSpan || !definitionAndBoundSpan.definitions) {
                return {
                    definitions: emptyArray,
                    textSpan: undefined
                };
            }

            if (simplifiedResult) {
                return {
                    definitions: this.mapDefinitionInfo(definitionAndBoundSpan.definitions, project),
                    textSpan: this.toLocationTextSpan(definitionAndBoundSpan.textSpan, scriptInfo)
                };
            }

            return definitionAndBoundSpan;
        }

        private mapDefinitionInfo(definitions: ReadonlyArray<DefinitionInfo>, project: Project): ReadonlyArray<protocol.FileSpan> {
            return definitions.map(def => this.toFileSpan(def.fileName, def.textSpan, project));
        }

        private toFileSpan(fileName: string, textSpan: TextSpan, project: Project): protocol.FileSpan {
            const scriptInfo = project.getScriptInfo(fileName);

            return {
                file: fileName,
                start: scriptInfo.positionToLineOffset(textSpan.start),
                end: scriptInfo.positionToLineOffset(textSpanEnd(textSpan))
            };
        }

        private getTypeDefinition(args: protocol.FileLocationRequestArgs): ReadonlyArray<protocol.FileSpan> {
            const { file, project } = this.getFileAndProject(args);
            const position = this.getPositionInFile(args, file);

            const definitions = project.getLanguageService().getTypeDefinitionAtPosition(file, position);
            if (!definitions) {
                return emptyArray;
            }

            return this.mapDefinitionInfo(definitions, project);
        }

        private getImplementation(args: protocol.FileLocationRequestArgs, simplifiedResult: boolean): ReadonlyArray<protocol.FileSpan> | ReadonlyArray<ImplementationLocation> {
            const { file, project } = this.getFileAndProject(args);
            const position = this.getPositionInFile(args, file);
            const implementations = project.getLanguageService().getImplementationAtPosition(file, position);
            if (!implementations) {
                return emptyArray;
            }
            if (simplifiedResult) {
                return implementations.map(({ fileName, textSpan }) => this.toFileSpan(fileName, textSpan, project));
            }
            else {
                return implementations;
            }
        }

        private getOccurrences(args: protocol.FileLocationRequestArgs): ReadonlyArray<protocol.OccurrencesResponseItem> {
            const { file, project } = this.getFileAndProject(args);

            const position = this.getPositionInFile(args, file);

            const occurrences = project.getLanguageService().getOccurrencesAtPosition(file, position);

            if (!occurrences) {
                return emptyArray;
            }

            return occurrences.map(occurrence => {
                const { fileName, isWriteAccess, textSpan, isInString } = occurrence;
                const scriptInfo = project.getScriptInfo(fileName);
                const result: protocol.OccurrencesResponseItem = {
                    start: scriptInfo.positionToLineOffset(textSpan.start),
                    end: scriptInfo.positionToLineOffset(textSpanEnd(textSpan)),
                    file: fileName,
                    isWriteAccess,
                };
                // no need to serialize the property if it is not true
                if (isInString) {
                    result.isInString = isInString;
                }
                return result;
            });
        }

        private getSyntacticDiagnosticsSync(args: protocol.SyntacticDiagnosticsSyncRequestArgs): ReadonlyArray<protocol.Diagnostic> | ReadonlyArray<protocol.DiagnosticWithLinePosition> {
            const { configFile } = this.getConfigFileAndProject(args);
            if (configFile) {
                // all the config file errors are reported as part of semantic check so nothing to report here
                return emptyArray;
            }

            return this.getDiagnosticsWorker(args, /*isSemantic*/ false, (project, file) => project.getLanguageService().getSyntacticDiagnostics(file), args.includeLinePosition);
        }

        private getSemanticDiagnosticsSync(args: protocol.SemanticDiagnosticsSyncRequestArgs): ReadonlyArray<protocol.Diagnostic> | ReadonlyArray<protocol.DiagnosticWithLinePosition> {
            const { configFile, project } = this.getConfigFileAndProject(args);
            if (configFile) {
                return this.getConfigFileDiagnostics(configFile, project, args.includeLinePosition);
            }
            return this.getDiagnosticsWorker(args, /*isSemantic*/ true, (project, file) => project.getLanguageService().getSemanticDiagnostics(file), args.includeLinePosition);
        }

        private getDocumentHighlights(args: protocol.DocumentHighlightsRequestArgs, simplifiedResult: boolean): ReadonlyArray<protocol.DocumentHighlightsItem> | ReadonlyArray<DocumentHighlights> {
            const { file, project } = this.getFileAndProject(args);
            const position = this.getPositionInFile(args, file);
            const documentHighlights = project.getLanguageService().getDocumentHighlights(file, position, args.filesToSearch);

            if (!documentHighlights) {
                return emptyArray;
            }

            if (simplifiedResult) {
                return documentHighlights.map(convertToDocumentHighlightsItem);
            }
            else {
                return documentHighlights;
            }

            function convertToDocumentHighlightsItem(documentHighlights: DocumentHighlights): protocol.DocumentHighlightsItem {
                const { fileName, highlightSpans } = documentHighlights;

                const scriptInfo = project.getScriptInfo(fileName);
                return {
                    file: fileName,
                    highlightSpans: highlightSpans.map(convertHighlightSpan)
                };

                function convertHighlightSpan(highlightSpan: HighlightSpan): protocol.HighlightSpan {
                    const { textSpan, kind } = highlightSpan;
                    const start = scriptInfo.positionToLineOffset(textSpan.start);
                    const end = scriptInfo.positionToLineOffset(textSpanEnd(textSpan));
                    return { start, end, kind };
                }
            }
        }

        private setCompilerOptionsForInferredProjects(args: protocol.SetCompilerOptionsForInferredProjectsArgs): void {
            this.projectService.setCompilerOptionsForInferredProjects(args.options, args.projectRootPath);
        }

        private getProjectInfo(args: protocol.ProjectInfoRequestArgs): protocol.ProjectInfo {
            return this.getProjectInfoWorker(args.file, args.projectFileName, args.needFileNameList, /*excludeConfigFiles*/ false);
        }

        private getProjectInfoWorker(uncheckedFileName: string, projectFileName: string, needFileNameList: boolean, excludeConfigFiles: boolean) {
            const { project } = this.getFileAndProjectWorker(uncheckedFileName, projectFileName);
            project.updateGraph();
            const projectInfo = {
                configFileName: project.getProjectName(),
                languageServiceDisabled: !project.languageServiceEnabled,
                fileNames: needFileNameList ? project.getFileNames(/*excludeFilesFromExternalLibraries*/ false, excludeConfigFiles) : undefined
            };
            return projectInfo;
        }

        private getRenameInfo(args: protocol.FileLocationRequestArgs) {
            const { file, project } = this.getFileAndProject(args);
            const position = this.getPositionInFile(args, file);
            return project.getLanguageService().getRenameInfo(file, position);
        }

        private getProjects(args: protocol.FileRequestArgs): Projects {
            let projects: ReadonlyArray<Project>;
            let symLinkedProjects: MultiMap<Project> | undefined;
            if (args.projectFileName) {
                const project = this.getProject(args.projectFileName);
                if (project) {
                    projects = [project];
                }
            }
            else {
                const scriptInfo = this.projectService.getScriptInfo(args.file);
                projects = scriptInfo.containingProjects;
                symLinkedProjects = this.projectService.getSymlinkedProjects(scriptInfo);
            }
            // filter handles case when 'projects' is undefined
            projects = filter(projects, p => p.languageServiceEnabled);
            if ((!projects || !projects.length) && !symLinkedProjects) {
                return Errors.ThrowNoProject();
            }
            return symLinkedProjects ? { projects, symLinkedProjects } : projects;
        }

        private getDefaultProject(args: protocol.FileRequestArgs) {
            if (args.projectFileName) {
                const project = this.getProject(args.projectFileName);
                if (project) {
                    return project;
                }
            }
            const info = this.projectService.getScriptInfo(args.file);
            return info.getDefaultProject();
        }

        private getRenameLocations(args: protocol.RenameRequestArgs, simplifiedResult: boolean): protocol.RenameResponseBody | ReadonlyArray<RenameLocation> {
            const file = toNormalizedPath(args.file);
            const position = this.getPositionInFile(args, file);
            const projects = this.getProjects(args);
            if (simplifiedResult) {

                const defaultProject = this.getDefaultProject(args);
                // The rename info should be the same for every project
                const renameInfo = defaultProject.getLanguageService().getRenameInfo(file, position);
                if (!renameInfo) {
                    return undefined;
                }

                if (!renameInfo.canRename) {
                    return {
                        info: renameInfo,
                        locs: emptyArray
                    };
                }

                const fileSpans = combineProjectOutput(
                    file,
                    path => this.projectService.getScriptInfoForPath(path).fileName,
                    projects,
                    (project, file) => {
                        const renameLocations = project.getLanguageService().findRenameLocations(file, position, args.findInStrings, args.findInComments);
                        if (!renameLocations) {
                            return emptyArray;
                        }

                        return renameLocations.map(location => {
                            const locationScriptInfo = project.getScriptInfo(location.fileName);
                            return {
                                file: location.fileName,
                                start: locationScriptInfo.positionToLineOffset(location.textSpan.start),
                                end: locationScriptInfo.positionToLineOffset(textSpanEnd(location.textSpan)),
                            };
                        });
                    },
                    compareRenameLocation,
                    (a, b) => a.file === b.file && a.start.line === b.start.line && a.start.offset === b.start.offset
                );

                const locs: protocol.SpanGroup[] = [];
                for (const cur of fileSpans) {
                    let curFileAccum: protocol.SpanGroup;
                    if (locs.length > 0) {
                        curFileAccum = locs[locs.length - 1];
                        if (curFileAccum.file !== cur.file) {
                            curFileAccum = undefined;
                        }
                    }
                    if (!curFileAccum) {
                        curFileAccum = { file: cur.file, locs: [] };
                        locs.push(curFileAccum);
                    }
                    curFileAccum.locs.push({ start: cur.start, end: cur.end });
                }

                return { info: renameInfo, locs };
            }
            else {
                return combineProjectOutput(
                    file,
                    path => this.projectService.getScriptInfoForPath(path).fileName,
                    projects,
                    (p, file) => p.getLanguageService().findRenameLocations(file, position, args.findInStrings, args.findInComments),
                    /*comparer*/ undefined,
                    renameLocationIsEqualTo
                );
            }

            function renameLocationIsEqualTo(a: RenameLocation, b: RenameLocation) {
                if (a === b) {
                    return true;
                }
                if (!a || !b) {
                    return false;
                }
                return a.fileName === b.fileName &&
                    a.textSpan.start === b.textSpan.start &&
                    a.textSpan.length === b.textSpan.length;
            }

            function compareRenameLocation(a: protocol.FileSpan, b: protocol.FileSpan) {
                if (a.file < b.file) {
                    return -1;
                }
                else if (a.file > b.file) {
                    return 1;
                }
                else {
                    // reverse sort assuming no overlap
                    if (a.start.line < b.start.line) {
                        return 1;
                    }
                    else if (a.start.line > b.start.line) {
                        return -1;
                    }
                    else {
                        return b.start.offset - a.start.offset;
                    }
                }
            }
        }

        private getReferences(args: protocol.FileLocationRequestArgs, simplifiedResult: boolean): protocol.ReferencesResponseBody | undefined | ReadonlyArray<ReferencedSymbol> {
            const file = toNormalizedPath(args.file);
            const projects = this.getProjects(args);

            const defaultProject = this.getDefaultProject(args);
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);
            const position = this.getPosition(args, scriptInfo);
            if (simplifiedResult) {
                const nameInfo = defaultProject.getLanguageService().getQuickInfoAtPosition(file, position);
                if (!nameInfo) {
                    return undefined;
                }
                const displayString = displayPartsToString(nameInfo.displayParts);
                const nameSpan = nameInfo.textSpan;
                const nameColStart = scriptInfo.positionToLineOffset(nameSpan.start).offset;
                const nameText = scriptInfo.getSnapshot().getText(nameSpan.start, textSpanEnd(nameSpan));
                const refs = combineProjectOutput<NormalizedPath, protocol.ReferencesResponseItem>(
                    file,
                    path => this.projectService.getScriptInfoForPath(path).fileName,
                    projects,
                    (project, file) => {
                        const references = project.getLanguageService().getReferencesAtPosition(file, position);
                        if (!references) {
                            return emptyArray;
                        }

                        return references.map(ref => {
                            const refScriptInfo = project.getScriptInfo(ref.fileName);
                            const start = refScriptInfo.positionToLineOffset(ref.textSpan.start);
                            const refLineSpan = refScriptInfo.lineToTextSpan(start.line - 1);
                            const lineText = refScriptInfo.getSnapshot().getText(refLineSpan.start, textSpanEnd(refLineSpan)).replace(/\r|\n/g, "");
                            return {
                                file: ref.fileName,
                                start,
                                lineText,
                                end: refScriptInfo.positionToLineOffset(textSpanEnd(ref.textSpan)),
                                isWriteAccess: ref.isWriteAccess,
                                isDefinition: ref.isDefinition
                            };
                        });
                    },
                    compareFileStart,
                    areReferencesResponseItemsForTheSameLocation
                );

                return {
                    refs,
                    symbolName: nameText,
                    symbolStartOffset: nameColStart,
                    symbolDisplayString: displayString
                };
            }
            else {
                return combineProjectOutput(
                    file,
                    path => this.projectService.getScriptInfoForPath(path).fileName,
                    projects,
                    (project, file) => project.getLanguageService().findReferences(file, position),
                    /*comparer*/ undefined,
                    equateValues
                );
            }

            function areReferencesResponseItemsForTheSameLocation(a: protocol.ReferencesResponseItem, b: protocol.ReferencesResponseItem) {
                if (a && b) {
                    return a.file === b.file &&
                        a.start === b.start &&
                        a.end === b.end;
                }
                return false;
            }
        }

        /**
         * @param fileName is the name of the file to be opened
         * @param fileContent is a version of the file content that is known to be more up to date than the one on disk
         */
        private openClientFile(fileName: NormalizedPath, fileContent?: string, scriptKind?: ScriptKind, projectRootPath?: NormalizedPath) {
            this.projectService.openClientFileWithNormalizedPath(fileName, fileContent, scriptKind, /*hasMixedContent*/ false, projectRootPath);
        }

        private getPosition(args: protocol.FileLocationRequestArgs, scriptInfo: ScriptInfo): number {
            return args.position !== undefined ? args.position : scriptInfo.lineOffsetToPosition(args.line, args.offset);
        }

        private getPositionInFile(args: protocol.FileLocationRequestArgs, file: NormalizedPath): number {
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);
            return this.getPosition(args, scriptInfo);
        }

        private getFileAndProject(args: protocol.FileRequestArgs) {
            return this.getFileAndProjectWorker(args.file, args.projectFileName);
        }

        private getFileAndLanguageServiceForSyntacticOperation(args: protocol.FileRequestArgs) {
            // Since this is syntactic operation, there should always be project for the file
            // we wouldnt have to ensure project but rather throw if we dont get project
            const file = toNormalizedPath(args.file);
            const project = this.getProject(args.projectFileName) || this.projectService.getDefaultProjectForFile(file, /*ensureProject*/ false);
            if (!project) {
                return Errors.ThrowNoProject();
            }
            return {
                file,
                languageService: project.getLanguageService(/*ensureSynchronized*/ false)
            };
        }

        private getFileAndProjectWorker(uncheckedFileName: string, projectFileName: string) {
            const file = toNormalizedPath(uncheckedFileName);
            const project: Project = this.getProject(projectFileName) || this.projectService.getDefaultProjectForFile(file, /*ensureProject*/ true);
            return { file, project };
        }

        private getOutliningSpans(args: protocol.FileRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            return languageService.getOutliningSpans(file);
        }

        private getTodoComments(args: protocol.TodoCommentRequestArgs) {
            const { file, project } = this.getFileAndProject(args);
            return project.getLanguageService().getTodoComments(file, args.descriptors);
        }

        private getDocCommentTemplate(args: protocol.FileLocationRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const position = this.getPositionInFile(args, file);
            return languageService.getDocCommentTemplateAtPosition(file, position);
        }

        private getSpanOfEnclosingComment(args: protocol.SpanOfEnclosingCommentRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const onlyMultiLine = args.onlyMultiLine;
            const position = this.getPositionInFile(args, file);
            return languageService.getSpanOfEnclosingComment(file, position, onlyMultiLine);
        }

        private getIndentation(args: protocol.IndentationRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const position = this.getPositionInFile(args, file);
            const options = args.options ? convertFormatOptions(args.options) : this.projectService.getFormatCodeOptions(file);
            const indentation = languageService.getIndentationAtPosition(file, position, options);
            return { position, indentation };
        }

        private getBreakpointStatement(args: protocol.FileLocationRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const position = this.getPositionInFile(args, file);
            return languageService.getBreakpointStatementAtPosition(file, position);
        }

        private getNameOrDottedNameSpan(args: protocol.FileLocationRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const position = this.getPositionInFile(args, file);
            return languageService.getNameOrDottedNameSpan(file, position, position);
        }

        private isValidBraceCompletion(args: protocol.BraceCompletionRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const position = this.getPositionInFile(args, file);
            return languageService.isValidBraceCompletionAtPosition(file, position, args.openingBrace.charCodeAt(0));
        }

        private getQuickInfoWorker(args: protocol.FileLocationRequestArgs, simplifiedResult: boolean): protocol.QuickInfoResponseBody | QuickInfo {
            const { file, project } = this.getFileAndProject(args);
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);
            const quickInfo = project.getLanguageService().getQuickInfoAtPosition(file, this.getPosition(args, scriptInfo));
            if (!quickInfo) {
                return undefined;
            }

            if (simplifiedResult) {
                const displayString = displayPartsToString(quickInfo.displayParts);
                const docString = displayPartsToString(quickInfo.documentation);

                return {
                    kind: quickInfo.kind,
                    kindModifiers: quickInfo.kindModifiers,
                    start: scriptInfo.positionToLineOffset(quickInfo.textSpan.start),
                    end: scriptInfo.positionToLineOffset(textSpanEnd(quickInfo.textSpan)),
                    displayString,
                    documentation: docString,
                    tags: quickInfo.tags || []
                };
            }
            else {
                return quickInfo;
            }
        }

        private getFormattingEditsForRange(args: protocol.FormatRequestArgs): protocol.CodeEdit[] {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);

            const startPosition = scriptInfo.lineOffsetToPosition(args.line, args.offset);
            const endPosition = scriptInfo.lineOffsetToPosition(args.endLine, args.endOffset);

            // TODO: avoid duplicate code (with formatonkey)
            const edits = languageService.getFormattingEditsForRange(file, startPosition, endPosition,
                this.projectService.getFormatCodeOptions(file));
            if (!edits) {
                return undefined;
            }

            return edits.map(edit => this.convertTextChangeToCodeEdit(edit, scriptInfo));
        }

        private getFormattingEditsForRangeFull(args: protocol.FormatRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const options = args.options ? convertFormatOptions(args.options) : this.projectService.getFormatCodeOptions(file);
            return languageService.getFormattingEditsForRange(file, args.position, args.endPosition, options);
        }

        private getFormattingEditsForDocumentFull(args: protocol.FormatRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const options = args.options ? convertFormatOptions(args.options) : this.projectService.getFormatCodeOptions(file);
            return languageService.getFormattingEditsForDocument(file, options);
        }

        private getFormattingEditsAfterKeystrokeFull(args: protocol.FormatOnKeyRequestArgs) {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const options = args.options ? convertFormatOptions(args.options) : this.projectService.getFormatCodeOptions(file);
            return languageService.getFormattingEditsAfterKeystroke(file, args.position, args.key, options);
        }

        private getFormattingEditsAfterKeystroke(args: protocol.FormatOnKeyRequestArgs): protocol.CodeEdit[] {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);
            const position = scriptInfo.lineOffsetToPosition(args.line, args.offset);
            const formatOptions = this.projectService.getFormatCodeOptions(file);
            const edits = languageService.getFormattingEditsAfterKeystroke(file, position, args.key,
                formatOptions);
            // Check whether we should auto-indent. This will be when
            // the position is on a line containing only whitespace.
            // This should leave the edits returned from
            // getFormattingEditsAfterKeystroke either empty or pertaining
            // only to the previous line.  If all this is true, then
            // add edits necessary to properly indent the current line.
            if ((args.key === "\n") && ((!edits) || (edits.length === 0) || allEditsBeforePos(edits, position))) {
                const { lineText, absolutePosition } = scriptInfo.getLineInfo(args.line);
                if (lineText && lineText.search("\\S") < 0) {
                    const preferredIndent = languageService.getIndentationAtPosition(file, position, formatOptions);
                    let hasIndent = 0;
                    let i: number, len: number;
                    for (i = 0, len = lineText.length; i < len; i++) {
                        if (lineText.charAt(i) === " ") {
                            hasIndent++;
                        }
                        else if (lineText.charAt(i) === "\t") {
                            hasIndent += formatOptions.tabSize;
                        }
                        else {
                            break;
                        }
                    }
                    // i points to the first non whitespace character
                    if (preferredIndent !== hasIndent) {
                        const firstNoWhiteSpacePosition = absolutePosition + i;
                        edits.push({
                            span: createTextSpanFromBounds(absolutePosition, firstNoWhiteSpacePosition),
                            newText: formatting.getIndentationString(preferredIndent, formatOptions)
                        });
                    }
                }
            }

            if (!edits) {
                return undefined;
            }

            return edits.map((edit) => {
                return {
                    start: scriptInfo.positionToLineOffset(edit.span.start),
                    end: scriptInfo.positionToLineOffset(textSpanEnd(edit.span)),
                    newText: edit.newText ? edit.newText : ""
                };
            });
        }

        private getCompletions(args: protocol.CompletionsRequestArgs, simplifiedResult: boolean): ReadonlyArray<protocol.CompletionEntry> | CompletionInfo | undefined {
            const prefix = args.prefix || "";
            const { file, project } = this.getFileAndProject(args);
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);
            const position = this.getPosition(args, scriptInfo);

            const completions = project.getLanguageService().getCompletionsAtPosition(file, position, args);
            if (simplifiedResult) {
                return mapDefined<CompletionEntry, protocol.CompletionEntry>(completions && completions.entries, entry => {
                    if (completions.isMemberCompletion || startsWith(entry.name.toLowerCase(), prefix.toLowerCase())) {
                        const { name, kind, kindModifiers, sortText, insertText, replacementSpan, hasAction, source, isRecommended } = entry;
                        const convertedSpan = replacementSpan ? this.toLocationTextSpan(replacementSpan, scriptInfo) : undefined;
                        // Use `hasAction || undefined` to avoid serializing `false`.
                        return { name, kind, kindModifiers, sortText, insertText, replacementSpan: convertedSpan, hasAction: hasAction || undefined, source, isRecommended };
                    }
                }).sort((a, b) => compareStringsCaseSensitiveUI(a.name, b.name));
            }
            else {
                return completions;
            }
        }

        private getCompletionEntryDetails(args: protocol.CompletionDetailsRequestArgs, simplifiedResult: boolean): ReadonlyArray<protocol.CompletionEntryDetails> | ReadonlyArray<CompletionEntryDetails> {
            const { file, project } = this.getFileAndProject(args);
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);
            const position = this.getPosition(args, scriptInfo);
            const formattingOptions = project.projectService.getFormatCodeOptions(file);

            const result = mapDefined(args.entryNames, entryName => {
                const { name, source } = typeof entryName === "string" ? { name: entryName, source: undefined } : entryName;
                return project.getLanguageService().getCompletionEntryDetails(file, position, name, formattingOptions, source);
            });
            return simplifiedResult
                ? result.map(details => ({ ...details, codeActions: map(details.codeActions, action => this.mapCodeAction(project, action)) }))
                : result;
        }

        private getCompileOnSaveAffectedFileList(args: protocol.FileRequestArgs): ReadonlyArray<protocol.CompileOnSaveAffectedFileListSingleProject> {
            const info = this.projectService.getScriptInfoEnsuringProjectsUptoDate(args.file);
            if (!info) {
                return emptyArray;
            }

            // if specified a project, we only return affected file list in this project
            const projects = args.projectFileName ? [this.projectService.findProject(args.projectFileName)] : info.containingProjects;
            const symLinkedProjects = !args.projectFileName && this.projectService.getSymlinkedProjects(info);
            return combineProjectOutput(
                info,
                path => this.projectService.getScriptInfoForPath(path),
                symLinkedProjects ? { projects, symLinkedProjects } : projects,
                (project, info) => {
                    let result: protocol.CompileOnSaveAffectedFileListSingleProject;
                    if (project.compileOnSaveEnabled && project.languageServiceEnabled && !project.getCompilationSettings().noEmit) {
                        result = {
                            projectFileName: project.getProjectName(),
                            fileNames: project.getCompileOnSaveAffectedFileList(info),
                            projectUsesOutFile: !!project.getCompilationSettings().outFile || !!project.getCompilationSettings().out
                        };
                    }
                    return result;
                }
            );
        }

        private emitFile(args: protocol.CompileOnSaveEmitFileRequestArgs) {
            const { file, project } = this.getFileAndProject(args);
            if (!project) {
                Errors.ThrowNoProject();
            }
            if (!project.languageServiceEnabled) {
                return false;
            }
            const scriptInfo = project.getScriptInfo(file);
            return project.emitFile(scriptInfo, (path, data, writeByteOrderMark) => this.host.writeFile(path, data, writeByteOrderMark));
        }

        private getSignatureHelpItems(args: protocol.SignatureHelpRequestArgs, simplifiedResult: boolean): protocol.SignatureHelpItems | SignatureHelpItems {
            const { file, project } = this.getFileAndProject(args);
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);
            const position = this.getPosition(args, scriptInfo);
            const helpItems = project.getLanguageService().getSignatureHelpItems(file, position);
            if (!helpItems) {
                return undefined;
            }

            if (simplifiedResult) {
                const span = helpItems.applicableSpan;
                return {
                    items: helpItems.items,
                    applicableSpan: {
                        start: scriptInfo.positionToLineOffset(span.start),
                        end: scriptInfo.positionToLineOffset(span.start + span.length)
                    },
                    selectedItemIndex: helpItems.selectedItemIndex,
                    argumentIndex: helpItems.argumentIndex,
                    argumentCount: helpItems.argumentCount,
                };
            }
            else {
                return helpItems;
            }
        }

        private createCheckList(fileNames: string[], defaultProject?: Project): PendingErrorCheck[] {
            return mapDefined<string, PendingErrorCheck>(fileNames, uncheckedFileName => {
                const fileName = toNormalizedPath(uncheckedFileName);
                const project = defaultProject || this.projectService.getDefaultProjectForFile(fileName, /*ensureProject*/ false);
                return project && { fileName, project };
            });
        }

        private getDiagnostics(next: NextStep, delay: number, fileNames: string[]): void {
            const checkList = this.createCheckList(fileNames);
            if (checkList.length > 0) {
                this.updateErrorCheck(next, checkList, delay);
            }
        }

        private change(args: protocol.ChangeRequestArgs) {
            const scriptInfo = this.projectService.getScriptInfo(args.file);
            Debug.assert(!!scriptInfo);
            const start = scriptInfo.lineOffsetToPosition(args.line, args.offset);
            const end = scriptInfo.lineOffsetToPosition(args.endLine, args.endOffset);
            if (start >= 0) {
                this.changeSeq++;
                this.projectService.applyChangesToFile(scriptInfo, [{
                    span: { start, length: end - start },
                    newText: args.insertString
                }]);
            }
        }

        private reload(args: protocol.ReloadRequestArgs, reqSeq: number) {
            const file = toNormalizedPath(args.file);
            const tempFileName = args.tmpfile && toNormalizedPath(args.tmpfile);
            const info = this.projectService.getScriptInfoForNormalizedPath(file);
            if (info) {
                this.changeSeq++;
                // make sure no changes happen before this one is finished
                if (info.reloadFromFile(tempFileName)) {
                    this.doOutput(/*info*/ undefined, CommandNames.Reload, reqSeq, /*success*/ true);
                }
            }
        }

        private saveToTmp(fileName: string, tempFileName: string) {
            const scriptInfo = this.projectService.getScriptInfo(fileName);
            if (scriptInfo) {
                scriptInfo.saveTo(tempFileName);
            }
        }

        private closeClientFile(fileName: string) {
            if (!fileName) {
                return;
            }
            const file = normalizePath(fileName);
            this.projectService.closeClientFile(file);
        }

        private mapLocationNavigationBarItems(items: NavigationBarItem[], scriptInfo: ScriptInfo): protocol.NavigationBarItem[] {
            return map(items, item => ({
                text: item.text,
                kind: item.kind,
                kindModifiers: item.kindModifiers,
                spans: item.spans.map(span => this.toLocationTextSpan(span, scriptInfo)),
                childItems: this.mapLocationNavigationBarItems(item.childItems, scriptInfo),
                indent: item.indent
            }));
        }

        private getNavigationBarItems(args: protocol.FileRequestArgs, simplifiedResult: boolean): protocol.NavigationBarItem[] | NavigationBarItem[] {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const items = languageService.getNavigationBarItems(file);
            return !items
                ? undefined
                : simplifiedResult
                    ? this.mapLocationNavigationBarItems(items, this.projectService.getScriptInfoForNormalizedPath(file))
                    : items;
        }

        private toLocationNavigationTree(tree: NavigationTree, scriptInfo: ScriptInfo): protocol.NavigationTree {
            return {
                text: tree.text,
                kind: tree.kind,
                kindModifiers: tree.kindModifiers,
                spans: tree.spans.map(span => this.toLocationTextSpan(span, scriptInfo)),
                childItems: map(tree.childItems, item => this.toLocationNavigationTree(item, scriptInfo))
            };
        }

        private toLocationTextSpan(span: TextSpan, scriptInfo: ScriptInfo): protocol.TextSpan {
            return {
                start: scriptInfo.positionToLineOffset(span.start),
                end: scriptInfo.positionToLineOffset(textSpanEnd(span))
            };
        }

        private getNavigationTree(args: protocol.FileRequestArgs, simplifiedResult: boolean): protocol.NavigationTree | NavigationTree {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const tree = languageService.getNavigationTree(file);
            return !tree
                ? undefined
                : simplifiedResult
                    ? this.toLocationNavigationTree(tree, this.projectService.getScriptInfoForNormalizedPath(file))
                    : tree;
        }

        private getNavigateToItems(args: protocol.NavtoRequestArgs, simplifiedResult: boolean): ReadonlyArray<protocol.NavtoItem> | ReadonlyArray<NavigateToItem> {
            const projects = this.getProjects(args);

            const fileName = args.currentFileOnly ? args.file && normalizeSlashes(args.file) : undefined;
            if (simplifiedResult) {
                return combineProjectOutput(
                    fileName,
                    () => undefined,
                    projects,
                    (project, file) => {
                        if (fileName && !file) {
                            return undefined;
                        }

                        const navItems = project.getLanguageService().getNavigateToItems(args.searchValue, args.maxResultCount, fileName, /*excludeDts*/ project.isNonTsProject());
                        if (!navItems) {
                            return emptyArray;
                        }

                        return navItems.map((navItem) => {
                            const scriptInfo = project.getScriptInfo(navItem.fileName);
                            const bakedItem: protocol.NavtoItem = {
                                name: navItem.name,
                                kind: navItem.kind,
                                file: navItem.fileName,
                                start: scriptInfo.positionToLineOffset(navItem.textSpan.start),
                                end: scriptInfo.positionToLineOffset(textSpanEnd(navItem.textSpan))
                            };
                            if (navItem.kindModifiers && (navItem.kindModifiers !== "")) {
                                bakedItem.kindModifiers = navItem.kindModifiers;
                            }
                            if (navItem.matchKind !== "none") {
                                bakedItem.matchKind = navItem.matchKind;
                            }
                            if (navItem.containerName && (navItem.containerName.length > 0)) {
                                bakedItem.containerName = navItem.containerName;
                            }
                            if (navItem.containerKind && (navItem.containerKind.length > 0)) {
                                bakedItem.containerKind = navItem.containerKind;
                            }
                            return bakedItem;
                        });
                    },
                    /*comparer*/ undefined,
                    areNavToItemsForTheSameLocation
                );
            }
            else {
                return combineProjectOutput(
                    fileName,
                    () => undefined,
                    projects,
                    (project, file) => {
                        if (fileName && !file) {
                            return undefined;
                        }
                        return project.getLanguageService().getNavigateToItems(args.searchValue, args.maxResultCount, fileName, /*excludeDts*/ project.isNonTsProject());
                    },
                    /*comparer*/ undefined,
                    navigateToItemIsEqualTo);
            }

            function navigateToItemIsEqualTo(a: NavigateToItem, b: NavigateToItem): boolean {
                if (a === b) {
                    return true;
                }
                if (!a || !b) {
                    return false;
                }
                return a.containerKind === b.containerKind &&
                    a.containerName === b.containerName &&
                    a.fileName === b.fileName &&
                    a.isCaseSensitive === b.isCaseSensitive &&
                    a.kind === b.kind &&
                    a.kindModifiers === b.containerName &&
                    a.matchKind === b.matchKind &&
                    a.name === b.name &&
                    a.textSpan.start === b.textSpan.start &&
                    a.textSpan.length === b.textSpan.length;
            }

            function areNavToItemsForTheSameLocation(a: protocol.NavtoItem, b: protocol.NavtoItem) {
                if (a && b) {
                    return a.file === b.file &&
                        a.start === b.start &&
                        a.end === b.end;
                }
                return false;
            }
        }

        private getSupportedCodeFixes(): string[] {
            return getSupportedCodeFixes();
        }

        private isLocation(locationOrSpan: protocol.FileLocationOrRangeRequestArgs): locationOrSpan is protocol.FileLocationRequestArgs {
            return (<protocol.FileLocationRequestArgs>locationOrSpan).line !== undefined;
        }

        private extractPositionAndRange(args: protocol.FileLocationOrRangeRequestArgs, scriptInfo: ScriptInfo): { position: number, textRange: TextRange } {
            let position: number = undefined;
            let textRange: TextRange;
            if (this.isLocation(args)) {
                position = getPosition(args);
            }
            else {
                const { startPosition, endPosition } = this.getStartAndEndPosition(args, scriptInfo);
                textRange = { pos: startPosition, end: endPosition };
            }
            return { position, textRange };

            function getPosition(loc: protocol.FileLocationRequestArgs) {
                return loc.position !== undefined ? loc.position : scriptInfo.lineOffsetToPosition(loc.line, loc.offset);
            }
        }

        private getApplicableRefactors(args: protocol.GetApplicableRefactorsRequestArgs): protocol.ApplicableRefactorInfo[] {
            const { file, project } = this.getFileAndProject(args);
            const scriptInfo = project.getScriptInfoForNormalizedPath(file);
            const { position, textRange } = this.extractPositionAndRange(args, scriptInfo);
            return project.getLanguageService().getApplicableRefactors(file, position || textRange);
        }

        private getEditsForRefactor(args: protocol.GetEditsForRefactorRequestArgs, simplifiedResult: boolean): RefactorEditInfo | protocol.RefactorEditInfo {
            const { file, project } = this.getFileAndProject(args);
            const scriptInfo = project.getScriptInfoForNormalizedPath(file);
            const { position, textRange } = this.extractPositionAndRange(args, scriptInfo);

            const result = project.getLanguageService().getEditsForRefactor(
                file,
                this.projectService.getFormatCodeOptions(file),
                position || textRange,
                args.refactor,
                args.action
            );

            if (result === undefined) {
                return {
                    edits: []
                };
            }

            if (simplifiedResult) {
                const { renameFilename, renameLocation, edits } = result;
                let mappedRenameLocation: protocol.Location | undefined;
                if (renameFilename !== undefined && renameLocation !== undefined) {
                    const renameScriptInfo = project.getScriptInfoForNormalizedPath(toNormalizedPath(renameFilename));
                    mappedRenameLocation = getLocationInNewDocument(getSnapshotText(renameScriptInfo.getSnapshot()), renameFilename, renameLocation, edits);
                }
                return { renameLocation: mappedRenameLocation, renameFilename, edits: this.mapTextChangesToCodeEdits(project, edits) };
            }
            else {
                return result;
            }
        }

        private getCodeFixes(args: protocol.CodeFixRequestArgs, simplifiedResult: boolean): ReadonlyArray<protocol.CodeAction> | ReadonlyArray<CodeAction> {
            if (args.errorCodes.length === 0) {
                return undefined;
            }
            const { file, project } = this.getFileAndProject(args);

            const scriptInfo = project.getScriptInfoForNormalizedPath(file);
            const { startPosition, endPosition } = this.getStartAndEndPosition(args, scriptInfo);
            const formatOptions = this.projectService.getFormatCodeOptions(file);

            const codeActions = project.getLanguageService().getCodeFixesAtPosition(file, startPosition, endPosition, args.errorCodes, formatOptions);
            if (!codeActions) {
                return undefined;
            }
            if (simplifiedResult) {
                return codeActions.map(codeAction => this.mapCodeAction(project, codeAction));
            }
            else {
                return codeActions;
            }
        }

        private getCombinedCodeFix({ scope, fixId }: protocol.GetCombinedCodeFixRequestArgs, simplifiedResult: boolean): protocol.CombinedCodeActions | CombinedCodeActions {
            Debug.assert(scope.type === "file");
            const { file, project } = this.getFileAndProject(scope.args);
            const formatOptions = this.projectService.getFormatCodeOptions(file);
            const res = project.getLanguageService().getCombinedCodeFix({ type: "file", fileName: file }, fixId, formatOptions);
            if (simplifiedResult) {
                return { changes: this.mapTextChangesToCodeEdits(project, res.changes), commands: res.commands };
            }
            else {
                return res;
            }
        }

        private applyCodeActionCommand(args: protocol.ApplyCodeActionCommandRequestArgs): {} {
            const commands = args.command as CodeActionCommand | CodeActionCommand[]; // They should be sending back the command we sent them.
            for (const command of toArray(commands)) {
                const { project } = this.getFileAndProject(command);
                project.getLanguageService().applyCodeActionCommand(command).then(
                    _result => { /* TODO: GH#20447 report success message? */ },
                    _error => { /* TODO: GH#20447 report errors */ });
            }
            return {};
        }

        private getStartAndEndPosition(args: protocol.FileRangeRequestArgs, scriptInfo: ScriptInfo) {
            let startPosition: number = undefined, endPosition: number = undefined;
            if (args.startPosition !== undefined) {
                startPosition = args.startPosition;
            }
            else {
                startPosition = scriptInfo.lineOffsetToPosition(args.startLine, args.startOffset);
                // save the result so we don't always recompute
                args.startPosition = startPosition;
            }

            if (args.endPosition !== undefined) {
                endPosition = args.endPosition;
            }
            else {
                endPosition = scriptInfo.lineOffsetToPosition(args.endLine, args.endOffset);
                args.endPosition = endPosition;
            }

            return { startPosition, endPosition };
        }

        private mapCodeAction(project: Project, { description, changes: unmappedChanges, commands, fixId }: CodeFixAction): protocol.CodeFixAction {
            const changes = unmappedChanges.map(change => this.mapTextChangesToCodeEditsUsingScriptinfo(change, project.getScriptInfoForNormalizedPath(toNormalizedPath(change.fileName))));
            return { description, changes, commands, fixId };
        }

        private mapTextChangesToCodeEdits(project: Project, textChanges: ReadonlyArray<FileTextChanges>): protocol.FileCodeEdits[] {
            return textChanges.map(change => this.mapTextChangesToCodeEditsUsingScriptinfo(change, project.getScriptInfoForNormalizedPath(toNormalizedPath(change.fileName))));
        }

        private mapTextChangesToCodeEditsUsingScriptinfo(textChanges: FileTextChanges, scriptInfo: ScriptInfo): protocol.FileCodeEdits {
            return {
                fileName: textChanges.fileName,
                textChanges: textChanges.textChanges.map(textChange => this.convertTextChangeToCodeEdit(textChange, scriptInfo))
            };
        }

        private convertTextChangeToCodeEdit(change: ts.TextChange, scriptInfo: ScriptInfo): protocol.CodeEdit {
            return {
                start: scriptInfo.positionToLineOffset(change.span.start),
                end: scriptInfo.positionToLineOffset(change.span.start + change.span.length),
                newText: change.newText ? change.newText : ""
            };
        }

        private getBraceMatching(args: protocol.FileLocationRequestArgs, simplifiedResult: boolean): protocol.TextSpan[] | TextSpan[] {
            const { file, languageService } = this.getFileAndLanguageServiceForSyntacticOperation(args);
            const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(file);
            const position = this.getPosition(args, scriptInfo);

            const spans = languageService.getBraceMatchingAtPosition(file, position);
            return !spans
                ? undefined
                : simplifiedResult
                    ? spans.map(span => this.toLocationTextSpan(span, scriptInfo))
                    : spans;
        }

        private getDiagnosticsForProject(next: NextStep, delay: number, fileName: string): void {
            const { fileNames, languageServiceDisabled } = this.getProjectInfoWorker(fileName, /*projectFileName*/ undefined, /*needFileNameList*/ true, /*excludeConfigFiles*/ true);
            if (languageServiceDisabled) {
                return;
            }

            // No need to analyze lib.d.ts
            const fileNamesInProject = fileNames.filter(value => !stringContains(value, "lib.d.ts"));
            if (fileNamesInProject.length === 0) {
                return;
            }

            // Sort the file name list to make the recently touched files come first
            const highPriorityFiles: NormalizedPath[] = [];
            const mediumPriorityFiles: NormalizedPath[] = [];
            const lowPriorityFiles: NormalizedPath[] = [];
            const veryLowPriorityFiles: NormalizedPath[] = [];
            const normalizedFileName = toNormalizedPath(fileName);
            const project = this.projectService.getDefaultProjectForFile(normalizedFileName, /*ensureProject*/ true);
            for (const fileNameInProject of fileNamesInProject) {
                if (this.getCanonicalFileName(fileNameInProject) === this.getCanonicalFileName(fileName)) {
                    highPriorityFiles.push(fileNameInProject);
                }
                else {
                    const info = this.projectService.getScriptInfo(fileNameInProject);
                    if (!info.isScriptOpen()) {
                        if (fileExtensionIs(fileNameInProject, Extension.Dts)) {
                            veryLowPriorityFiles.push(fileNameInProject);
                        }
                        else {
                            lowPriorityFiles.push(fileNameInProject);
                        }
                    }
                    else {
                        mediumPriorityFiles.push(fileNameInProject);
                    }
                }
            }

            const sortedFiles = [...highPriorityFiles, ...mediumPriorityFiles, ...lowPriorityFiles, ...veryLowPriorityFiles];
            const checkList = sortedFiles.map(fileName => ({ fileName, project }));
            // Project level error analysis runs on background files too, therefore
            // doesn't require the file to be opened
            this.updateErrorCheck(next, checkList, delay, /*requireOpen*/ false);
        }

        getCanonicalFileName(fileName: string) {
            const name = this.host.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();
            return normalizePath(name);
        }

        exit() { /*overridden*/ }

        private notRequired(): HandlerResponse {
            return { responseRequired: false };
        }

        private requiredResponse(response: {}): HandlerResponse {
            return { response, responseRequired: true };
        }

        private handlers = createMapFromTemplate<(request: protocol.Request) => HandlerResponse>({
            [CommandNames.Status]: () => {
                const response: protocol.StatusResponseBody = { version };
                return this.requiredResponse(response);
            },
            [CommandNames.OpenExternalProject]: (request: protocol.OpenExternalProjectRequest) => {
                this.projectService.openExternalProject(request.arguments, /*suppressRefreshOfInferredProjects*/ false);
                // TODO: GH#20447 report errors
                return this.requiredResponse(/*response*/ true);
            },
            [CommandNames.OpenExternalProjects]: (request: protocol.OpenExternalProjectsRequest) => {
                this.projectService.openExternalProjects(request.arguments.projects);
                // TODO: GH#20447 report errors
                return this.requiredResponse(/*response*/ true);
            },
            [CommandNames.CloseExternalProject]: (request: protocol.CloseExternalProjectRequest) => {
                this.projectService.closeExternalProject(request.arguments.projectFileName);
                // TODO: GH#20447 report errors
                return this.requiredResponse(/*response*/ true);
            },
            [CommandNames.SynchronizeProjectList]: (request: protocol.SynchronizeProjectListRequest) => {
                const result = this.projectService.synchronizeProjectList(request.arguments.knownProjects);
                if (!result.some(p => p.projectErrors && p.projectErrors.length !== 0)) {
                    return this.requiredResponse(result);
                }
                const converted = map(result, p => {
                    if (!p.projectErrors || p.projectErrors.length === 0) {
                        return p;
                    }
                    return {
                        info: p.info,
                        changes: p.changes,
                        files: p.files,
                        projectErrors: this.convertToDiagnosticsWithLinePosition(p.projectErrors, /*scriptInfo*/ undefined)
                    };
                });
                return this.requiredResponse(converted);
            },
            [CommandNames.ApplyChangedToOpenFiles]: (request: protocol.ApplyChangedToOpenFilesRequest) => {
                this.changeSeq++;
                this.projectService.applyChangesInOpenFiles(request.arguments.openFiles, request.arguments.changedFiles, request.arguments.closedFiles);
                // TODO: report errors
                return this.requiredResponse(/*response*/ true);
            },
            [CommandNames.Exit]: () => {
                this.exit();
                return this.notRequired();
            },
            [CommandNames.Definition]: (request: protocol.DefinitionRequest) => {
                return this.requiredResponse(this.getDefinition(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.DefinitionFull]: (request: protocol.DefinitionRequest) => {
                return this.requiredResponse(this.getDefinition(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.DefinitionAndBoundSpan]: (request: protocol.DefinitionRequest) => {
                return this.requiredResponse(this.getDefinitionAndBoundSpan(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.DefinitionAndBoundSpanFull]: (request: protocol.DefinitionRequest) => {
                return this.requiredResponse(this.getDefinitionAndBoundSpan(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.TypeDefinition]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getTypeDefinition(request.arguments));
            },
            [CommandNames.Implementation]: (request: protocol.Request) => {
                return this.requiredResponse(this.getImplementation(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.ImplementationFull]: (request: protocol.Request) => {
                return this.requiredResponse(this.getImplementation(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.References]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getReferences(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.ReferencesFull]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getReferences(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.Rename]: (request: protocol.Request) => {
                return this.requiredResponse(this.getRenameLocations(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.RenameLocationsFull]: (request: protocol.RenameRequest) => {
                return this.requiredResponse(this.getRenameLocations(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.RenameInfoFull]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getRenameInfo(request.arguments));
            },
            [CommandNames.Open]: (request: protocol.OpenRequest) => {
                this.openClientFile(
                    toNormalizedPath(request.arguments.file),
                    request.arguments.fileContent,
                    convertScriptKindName(request.arguments.scriptKindName),
                    request.arguments.projectRootPath ? toNormalizedPath(request.arguments.projectRootPath) : undefined);
                return this.notRequired();
            },
            [CommandNames.Quickinfo]: (request: protocol.QuickInfoRequest) => {
                return this.requiredResponse(this.getQuickInfoWorker(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.QuickinfoFull]: (request: protocol.QuickInfoRequest) => {
                return this.requiredResponse(this.getQuickInfoWorker(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.OutliningSpans]: (request: protocol.FileRequest) => {
                return this.requiredResponse(this.getOutliningSpans(request.arguments));
            },
            [CommandNames.TodoComments]: (request: protocol.TodoCommentRequest) => {
                return this.requiredResponse(this.getTodoComments(request.arguments));
            },
            [CommandNames.Indentation]: (request: protocol.IndentationRequest) => {
                return this.requiredResponse(this.getIndentation(request.arguments));
            },
            [CommandNames.NameOrDottedNameSpan]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getNameOrDottedNameSpan(request.arguments));
            },
            [CommandNames.BreakpointStatement]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getBreakpointStatement(request.arguments));
            },
            [CommandNames.BraceCompletion]: (request: protocol.BraceCompletionRequest) => {
                return this.requiredResponse(this.isValidBraceCompletion(request.arguments));
            },
            [CommandNames.DocCommentTemplate]: (request: protocol.DocCommentTemplateRequest) => {
                return this.requiredResponse(this.getDocCommentTemplate(request.arguments));
            },
            [CommandNames.GetSpanOfEnclosingComment]: (request: protocol.SpanOfEnclosingCommentRequest) => {
                return this.requiredResponse(this.getSpanOfEnclosingComment(request.arguments));
            },
            [CommandNames.Format]: (request: protocol.FormatRequest) => {
                return this.requiredResponse(this.getFormattingEditsForRange(request.arguments));
            },
            [CommandNames.Formatonkey]: (request: protocol.FormatOnKeyRequest) => {
                return this.requiredResponse(this.getFormattingEditsAfterKeystroke(request.arguments));
            },
            [CommandNames.FormatFull]: (request: protocol.FormatRequest) => {
                return this.requiredResponse(this.getFormattingEditsForDocumentFull(request.arguments));
            },
            [CommandNames.FormatonkeyFull]: (request: protocol.FormatOnKeyRequest) => {
                return this.requiredResponse(this.getFormattingEditsAfterKeystrokeFull(request.arguments));
            },
            [CommandNames.FormatRangeFull]: (request: protocol.FormatRequest) => {
                return this.requiredResponse(this.getFormattingEditsForRangeFull(request.arguments));
            },
            [CommandNames.Completions]: (request: protocol.CompletionsRequest) => {
                return this.requiredResponse(this.getCompletions(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.CompletionsFull]: (request: protocol.CompletionsRequest) => {
                return this.requiredResponse(this.getCompletions(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.CompletionDetails]: (request: protocol.CompletionDetailsRequest) => {
                return this.requiredResponse(this.getCompletionEntryDetails(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.CompletionDetailsFull]: (request: protocol.CompletionDetailsRequest) => {
                return this.requiredResponse(this.getCompletionEntryDetails(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.CompileOnSaveAffectedFileList]: (request: protocol.CompileOnSaveAffectedFileListRequest) => {
                return this.requiredResponse(this.getCompileOnSaveAffectedFileList(request.arguments));
            },
            [CommandNames.CompileOnSaveEmitFile]: (request: protocol.CompileOnSaveEmitFileRequest) => {
                return this.requiredResponse(this.emitFile(request.arguments));
            },
            [CommandNames.SignatureHelp]: (request: protocol.SignatureHelpRequest) => {
                return this.requiredResponse(this.getSignatureHelpItems(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.SignatureHelpFull]: (request: protocol.SignatureHelpRequest) => {
                return this.requiredResponse(this.getSignatureHelpItems(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.CompilerOptionsDiagnosticsFull]: (request: protocol.CompilerOptionsDiagnosticsRequest) => {
                return this.requiredResponse(this.getCompilerOptionsDiagnostics(request.arguments));
            },
            [CommandNames.EncodedSemanticClassificationsFull]: (request: protocol.EncodedSemanticClassificationsRequest) => {
                return this.requiredResponse(this.getEncodedSemanticClassifications(request.arguments));
            },
            [CommandNames.Cleanup]: () => {
                this.cleanup();
                return this.requiredResponse(/*response*/ true);
            },
            [CommandNames.SemanticDiagnosticsSync]: (request: protocol.SemanticDiagnosticsSyncRequest) => {
                return this.requiredResponse(this.getSemanticDiagnosticsSync(request.arguments));
            },
            [CommandNames.SyntacticDiagnosticsSync]: (request: protocol.SyntacticDiagnosticsSyncRequest) => {
                return this.requiredResponse(this.getSyntacticDiagnosticsSync(request.arguments));
            },
            [CommandNames.Geterr]: (request: protocol.GeterrRequest) => {
                this.errorCheck.startNew(next => this.getDiagnostics(next, request.arguments.delay, request.arguments.files));
                return this.notRequired();
            },
            [CommandNames.GeterrForProject]: (request: protocol.GeterrForProjectRequest) => {
                this.errorCheck.startNew(next => this.getDiagnosticsForProject(next, request.arguments.delay, request.arguments.file));
                return this.notRequired();
            },
            [CommandNames.Change]: (request: protocol.ChangeRequest) => {
                this.change(request.arguments);
                return this.notRequired();
            },
            [CommandNames.Configure]: (request: protocol.ConfigureRequest) => {
                this.projectService.setHostConfiguration(request.arguments);
                this.doOutput(/*info*/ undefined, CommandNames.Configure, request.seq, /*success*/ true);
                return this.notRequired();
            },
            [CommandNames.Reload]: (request: protocol.ReloadRequest) => {
                this.reload(request.arguments, request.seq);
                return this.requiredResponse({ reloadFinished: true });
            },
            [CommandNames.Saveto]: (request: protocol.Request) => {
                const savetoArgs = <protocol.SavetoRequestArgs>request.arguments;
                this.saveToTmp(savetoArgs.file, savetoArgs.tmpfile);
                return this.notRequired();
            },
            [CommandNames.Close]: (request: protocol.Request) => {
                const closeArgs = <protocol.FileRequestArgs>request.arguments;
                this.closeClientFile(closeArgs.file);
                return this.notRequired();
            },
            [CommandNames.Navto]: (request: protocol.NavtoRequest) => {
                return this.requiredResponse(this.getNavigateToItems(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.NavtoFull]: (request: protocol.NavtoRequest) => {
                return this.requiredResponse(this.getNavigateToItems(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.Brace]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getBraceMatching(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.BraceFull]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getBraceMatching(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.NavBar]: (request: protocol.FileRequest) => {
                return this.requiredResponse(this.getNavigationBarItems(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.NavBarFull]: (request: protocol.FileRequest) => {
                return this.requiredResponse(this.getNavigationBarItems(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.NavTree]: (request: protocol.FileRequest) => {
                return this.requiredResponse(this.getNavigationTree(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.NavTreeFull]: (request: protocol.FileRequest) => {
                return this.requiredResponse(this.getNavigationTree(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.Occurrences]: (request: protocol.FileLocationRequest) => {
                return this.requiredResponse(this.getOccurrences(request.arguments));
            },
            [CommandNames.DocumentHighlights]: (request: protocol.DocumentHighlightsRequest) => {
                return this.requiredResponse(this.getDocumentHighlights(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.DocumentHighlightsFull]: (request: protocol.DocumentHighlightsRequest) => {
                return this.requiredResponse(this.getDocumentHighlights(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.CompilerOptionsForInferredProjects]: (request: protocol.SetCompilerOptionsForInferredProjectsRequest) => {
                this.setCompilerOptionsForInferredProjects(request.arguments);
                return this.requiredResponse(/*response*/ true);
            },
            [CommandNames.ProjectInfo]: (request: protocol.ProjectInfoRequest) => {
                return this.requiredResponse(this.getProjectInfo(request.arguments));
            },
            [CommandNames.ReloadProjects]: () => {
                this.projectService.reloadProjects();
                return this.notRequired();
            },
            [CommandNames.GetCodeFixes]: (request: protocol.CodeFixRequest) => {
                return this.requiredResponse(this.getCodeFixes(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.GetCodeFixesFull]: (request: protocol.CodeFixRequest) => {
                return this.requiredResponse(this.getCodeFixes(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.GetCombinedCodeFix]: (request: protocol.GetCombinedCodeFixRequest) => {
                return this.requiredResponse(this.getCombinedCodeFix(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.GetCombinedCodeFixFull]: (request: protocol.GetCombinedCodeFixRequest) => {
                return this.requiredResponse(this.getCombinedCodeFix(request.arguments, /*simplifiedResult*/ false));
            },
            [CommandNames.ApplyCodeActionCommand]: (request: protocol.ApplyCodeActionCommandRequest) => {
                return this.requiredResponse(this.applyCodeActionCommand(request.arguments));
            },
            [CommandNames.GetSupportedCodeFixes]: () => {
                return this.requiredResponse(this.getSupportedCodeFixes());
            },
            [CommandNames.GetApplicableRefactors]: (request: protocol.GetApplicableRefactorsRequest) => {
                return this.requiredResponse(this.getApplicableRefactors(request.arguments));
            },
            [CommandNames.GetEditsForRefactor]: (request: protocol.GetEditsForRefactorRequest) => {
                return this.requiredResponse(this.getEditsForRefactor(request.arguments, /*simplifiedResult*/ true));
            },
            [CommandNames.GetEditsForRefactorFull]: (request: protocol.GetEditsForRefactorRequest) => {
                return this.requiredResponse(this.getEditsForRefactor(request.arguments, /*simplifiedResult*/ false));
            }
        });

        public addProtocolHandler(command: string, handler: (request: protocol.Request) => HandlerResponse) {
            if (this.handlers.has(command)) {
                throw new Error(`Protocol handler already exists for command "${command}"`);
            }
            this.handlers.set(command, handler);
        }

        private setCurrentRequest(requestId: number): void {
            Debug.assert(this.currentRequestId === undefined);
            this.currentRequestId = requestId;
            this.cancellationToken.setRequest(requestId);
        }

        private resetCurrentRequest(requestId: number): void {
            Debug.assert(this.currentRequestId === requestId);
            this.currentRequestId = undefined;
            this.cancellationToken.resetRequest(requestId);
        }

        public executeWithRequestId<T>(requestId: number, f: () => T) {
            try {
                this.setCurrentRequest(requestId);
                return f();
            }
            finally {
                this.resetCurrentRequest(requestId);
            }
        }

        public executeCommand(request: protocol.Request): HandlerResponse {
            const handler = this.handlers.get(request.command);
            if (handler) {
                return this.executeWithRequestId(request.seq, () => handler(request));
            }
            else {
                this.logger.msg(`Unrecognized JSON command:${stringifyIndented(request)}`, Msg.Err);
                this.doOutput(/*info*/ undefined, CommandNames.Unknown, request.seq, /*success*/ false, `Unrecognized JSON command: ${request.command}`);
                return { responseRequired: false };
            }
        }

        public onMessage(message: string) {
            this.gcTimer.scheduleCollect();
            let start: number[];
            if (this.logger.hasLevel(LogLevel.requestTime)) {
                start = this.hrtime();
                if (this.logger.hasLevel(LogLevel.verbose)) {
                    this.logger.info(`request:${indent(message)}`);
                }
            }

            let request: protocol.Request;
            try {
                request = <protocol.Request>JSON.parse(message);
                const { response, responseRequired } = this.executeCommand(request);

                if (this.logger.hasLevel(LogLevel.requestTime)) {
                    const elapsedTime = hrTimeToMilliseconds(this.hrtime(start)).toFixed(4);
                    if (responseRequired) {
                        this.logger.perftrc(`${request.seq}::${request.command}: elapsed time (in milliseconds) ${elapsedTime}`);
                    }
                    else {
                        this.logger.perftrc(`${request.seq}::${request.command}: async elapsed time (in milliseconds) ${elapsedTime}`);
                    }
                }

                if (response) {
                    this.doOutput(response, request.command, request.seq, /*success*/ true);
                }
                else if (responseRequired) {
                    this.doOutput(/*info*/ undefined, request.command, request.seq, /*success*/ false, "No content available.");
                }
            }
            catch (err) {
                if (err instanceof OperationCanceledException) {
                    // Handle cancellation exceptions
                    this.doOutput({ canceled: true }, request.command, request.seq, /*success*/ true);
                    return;
                }
                this.logError(err, message);
                this.doOutput(
                    /*info*/ undefined,
                    request ? request.command : CommandNames.Unknown,
                    request ? request.seq : 0,
                    /*success*/ false,
                    "Error processing request. " + (<StackTraceError>err).message + "\n" + (<StackTraceError>err).stack);
            }
        }
    }

    export interface HandlerResponse {
        response?: {};
        responseRequired?: boolean;
    }

    /* @internal */ // Exported only for tests
    export function getLocationInNewDocument(oldText: string, renameFilename: string, renameLocation: number, edits: ReadonlyArray<FileTextChanges>): protocol.Location {
        const newText = applyEdits(oldText, renameFilename, edits);
        const { line, character } = computeLineAndCharacterOfPosition(computeLineStarts(newText), renameLocation);
        return { line: line + 1, offset: character + 1 };
    }

    function applyEdits(text: string, textFilename: string, edits: ReadonlyArray<FileTextChanges>): string {
        for (const { fileName, textChanges } of edits) {
            if (fileName !== textFilename) {
                continue;
            }

            for (let i = textChanges.length - 1; i >= 0; i--) {
                const { newText, span: { start, length } } = textChanges[i];
                text = text.slice(0, start) + newText + text.slice(start + length);
            }
        }

        return text;
    }
}
