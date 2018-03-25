/* @internal */
namespace ts.codefix {
    import ChangeTracker = textChanges.ChangeTracker;

    registerCodeFix({
        errorCodes: [
            Diagnostics.Cannot_find_name_0.code,
            Diagnostics.Cannot_find_name_0_Did_you_mean_1.code,
            Diagnostics.Cannot_find_namespace_0.code,
            Diagnostics._0_refers_to_a_UMD_global_but_the_current_file_is_a_module_Consider_adding_an_import_instead.code
        ],
        getCodeActions: getImportCodeActions,
        // TODO: GH#20315
        fixIds: [],
        getAllCodeActions: notImplemented,
    });

    type ImportCodeActionKind = "CodeChange" | "InsertingIntoExistingImport" | "NewImport";
    // Map from module Id to an array of import declarations in that module.
    type ImportDeclarationMap = AnyImportSyntax[][];

    interface ImportCodeAction extends CodeFixAction {
        kind: ImportCodeActionKind;
        moduleSpecifier?: string;
    }

    interface SymbolContext extends textChanges.TextChangesContext {
        sourceFile: SourceFile;
        symbolName: string;
    }

    interface ImportCodeFixContext extends SymbolContext {
        symbolToken: Identifier | undefined;
        program: Program;
        checker: TypeChecker;
        compilerOptions: CompilerOptions;
        getCanonicalFileName: GetCanonicalFileName;
        cachedImportDeclarations?: ImportDeclarationMap;
    }

    export interface ImportCodeFixOptions extends ImportCodeFixContext {
        kind: ImportKind;
    }

    const enum ModuleSpecifierComparison {
        Better,
        Equal,
        Worse
    }

    class ImportCodeActionMap {
        private symbolIdToActionMap: ImportCodeAction[][] = [];

        addAction(symbolId: number, newAction: ImportCodeAction) {
            const actions = this.symbolIdToActionMap[symbolId];
            if (!actions) {
                this.symbolIdToActionMap[symbolId] = [newAction];
                return;
            }

            if (newAction.kind === "CodeChange") {
                actions.push(newAction);
                return;
            }

            const updatedNewImports: ImportCodeAction[] = [];
            for (const existingAction of this.symbolIdToActionMap[symbolId]) {
                if (existingAction.kind === "CodeChange") {
                    // only import actions should compare
                    updatedNewImports.push(existingAction);
                    continue;
                }

                switch (this.compareModuleSpecifiers(existingAction.moduleSpecifier, newAction.moduleSpecifier)) {
                    case ModuleSpecifierComparison.Better:
                        // the new one is not worth considering if it is a new import.
                        // However if it is instead a insertion into existing import, the user might want to use
                        // the module specifier even it is worse by our standards. So keep it.
                        if (newAction.kind === "NewImport") {
                            return;
                        }
                        // falls through
                    case ModuleSpecifierComparison.Equal:
                        // the current one is safe. But it is still possible that the new one is worse
                        // than another existing one. For example, you may have new imports from "./foo/bar"
                        // and "bar", when the new one is "bar/bar2" and the current one is "./foo/bar". The new
                        // one and the current one are not comparable (one relative path and one absolute path),
                        // but the new one is worse than the other one, so should not add to the list.
                        updatedNewImports.push(existingAction);
                        break;
                    case ModuleSpecifierComparison.Worse:
                        // the existing one is worse, remove from the list.
                        continue;
                }
            }
            // if we reach here, it means the new one is better or equal to all of the existing ones.
            updatedNewImports.push(newAction);
            this.symbolIdToActionMap[symbolId] = updatedNewImports;
        }

        addActions(symbolId: number, newActions: ImportCodeAction[]) {
            for (const newAction of newActions) {
                this.addAction(symbolId, newAction);
            }
        }

        getAllActions() {
            let result: ImportCodeAction[] = [];
            for (const key in this.symbolIdToActionMap) {
                result = concatenate(result, this.symbolIdToActionMap[key]);
            }
            return result;
        }

        private compareModuleSpecifiers(moduleSpecifier1: string, moduleSpecifier2: string): ModuleSpecifierComparison {
            if (moduleSpecifier1 === moduleSpecifier2) {
                return ModuleSpecifierComparison.Equal;
            }

            // if moduleSpecifier1 (ms1) is a substring of ms2, then it is better
            if (moduleSpecifier2.indexOf(moduleSpecifier1) === 0) {
                return ModuleSpecifierComparison.Better;
            }

            if (moduleSpecifier1.indexOf(moduleSpecifier2) === 0) {
                return ModuleSpecifierComparison.Worse;
            }

            // if both are relative paths, and ms1 has fewer levels, then it is better
            if (isExternalModuleNameRelative(moduleSpecifier1) && isExternalModuleNameRelative(moduleSpecifier2)) {
                const regex = new RegExp(directorySeparator, "g");
                const moduleSpecifier1LevelCount = (moduleSpecifier1.match(regex) || []).length;
                const moduleSpecifier2LevelCount = (moduleSpecifier2.match(regex) || []).length;

                return moduleSpecifier1LevelCount < moduleSpecifier2LevelCount
                    ? ModuleSpecifierComparison.Better
                    : moduleSpecifier1LevelCount === moduleSpecifier2LevelCount
                        ? ModuleSpecifierComparison.Equal
                        : ModuleSpecifierComparison.Worse;
            }

            // the equal cases include when the two specifiers are not comparable.
            return ModuleSpecifierComparison.Equal;
        }
    }

    function createCodeAction(
        description: DiagnosticMessage,
        diagnosticArgs: string[],
        changes: FileTextChanges[],
        kind: ImportCodeActionKind,
        moduleSpecifier: string | undefined,
    ): ImportCodeAction {
        return {
            description: formatMessage.apply(undefined, [undefined, description].concat(<any[]>diagnosticArgs)),
            changes,
            // TODO: GH#20315
            fixId: undefined,
            kind,
            moduleSpecifier
        };
    }

    function convertToImportCodeFixContext(context: CodeFixContext): ImportCodeFixContext {
        const useCaseSensitiveFileNames = context.host.useCaseSensitiveFileNames ? context.host.useCaseSensitiveFileNames() : false;
        const { program } = context;
        const checker = program.getTypeChecker();
        // This will always be an Identifier, since the diagnostics we fix only fail on identifiers.
        const symbolToken = cast(getTokenAtPosition(context.sourceFile, context.span.start, /*includeJsDocComment*/ false), isIdentifier);
        return {
            host: context.host,
            formatContext: context.formatContext,
            sourceFile: context.sourceFile,
            program,
            checker,
            compilerOptions: program.getCompilerOptions(),
            cachedImportDeclarations: [],
            getCanonicalFileName: createGetCanonicalFileName(useCaseSensitiveFileNames),
            symbolName: symbolToken.getText(),
            symbolToken,
        };
    }

    export const enum ImportKind {
        Named,
        Default,
        Namespace,
        Equals
    }

    export function getCodeActionForImport(moduleSymbols: Symbol | ReadonlyArray<Symbol>, context: ImportCodeFixOptions): ImportCodeAction[] {
        moduleSymbols = toArray(moduleSymbols);
        const declarations = flatMap(moduleSymbols, moduleSymbol =>
            getImportDeclarations(moduleSymbol, context.checker, context.sourceFile, context.cachedImportDeclarations));
        const actions: ImportCodeAction[] = [];
        if (context.symbolToken) {
            // It is possible that multiple import statements with the same specifier exist in the file.
            // e.g.
            //
            //     import * as ns from "foo";
            //     import { member1, member2 } from "foo";
            //
            //     member3/**/ <-- cusor here
            //
            // in this case we should provie 2 actions:
            //     1. change "member3" to "ns.member3"
            //     2. add "member3" to the second import statement's import list
            // and it is up to the user to decide which one fits best.
            for (const declaration of declarations) {
                const namespace = getNamespaceImportName(declaration);
                if (namespace) {
                    const moduleSymbol = context.checker.getAliasedSymbol(context.checker.getSymbolAtLocation(namespace));
                    if (moduleSymbol && moduleSymbol.exports.has(escapeLeadingUnderscores(context.symbolName))) {
                        actions.push(getCodeActionForUseExistingNamespaceImport(namespace.text, context, context.symbolToken));
                    }
                }
            }
        }
        return [...actions, ...getCodeActionsForAddImport(moduleSymbols, context, declarations)];
    }

    function getNamespaceImportName(declaration: AnyImportSyntax): Identifier | undefined {
        if (declaration.kind === SyntaxKind.ImportDeclaration) {
            const namedBindings = declaration.importClause && isImportClause(declaration.importClause) && declaration.importClause.namedBindings;
            return namedBindings && namedBindings.kind === SyntaxKind.NamespaceImport ? namedBindings.name : undefined;
        }
        else {
            return declaration.name;
        }
    }

    // TODO(anhans): This doesn't seem important to cache... just use an iterator instead of creating a new array?
    function getImportDeclarations(moduleSymbol: Symbol, checker: TypeChecker, { imports }: SourceFile, cachedImportDeclarations: ImportDeclarationMap = []): ReadonlyArray<AnyImportSyntax> {
        const moduleSymbolId = getUniqueSymbolId(moduleSymbol, checker);
        let cached = cachedImportDeclarations[moduleSymbolId];
        if (!cached) {
            cached = cachedImportDeclarations[moduleSymbolId] = mapDefined(imports, importModuleSpecifier =>
                checker.getSymbolAtLocation(importModuleSpecifier) === moduleSymbol ? getImportDeclaration(importModuleSpecifier) : undefined);
        }
        return cached;
    }

    function getImportDeclaration({ parent }: LiteralExpression): AnyImportSyntax | undefined {
        switch (parent.kind) {
            case SyntaxKind.ImportDeclaration:
                return parent as ImportDeclaration;
            case SyntaxKind.ExternalModuleReference:
                return (parent as ExternalModuleReference).parent;
            case SyntaxKind.ExportDeclaration:
            case SyntaxKind.CallExpression: // For "require()" calls
                // Ignore these, can't add imports to them.
                return undefined;
            default:
                Debug.fail();
        }
    }

    function getCodeActionForNewImport(context: SymbolContext & { kind: ImportKind }, moduleSpecifier: string): ImportCodeAction {
        const { kind, sourceFile, symbolName } = context;
        const lastImportDeclaration = findLast(sourceFile.statements, isAnyImportSyntax);

        const moduleSpecifierWithoutQuotes = stripQuotes(moduleSpecifier);
        const quotedModuleSpecifier = createStringLiteralWithQuoteStyle(sourceFile, moduleSpecifierWithoutQuotes);
        const importDecl = kind !== ImportKind.Equals
            ? createImportDeclaration(
                /*decorators*/ undefined,
                /*modifiers*/ undefined,
                createImportClauseOfKind(kind, symbolName),
                quotedModuleSpecifier)
            : createImportEqualsDeclaration(
                /*decorators*/ undefined,
                /*modifiers*/ undefined,
                createIdentifier(symbolName),
                createExternalModuleReference(quotedModuleSpecifier));

        const changes = ChangeTracker.with(context, changeTracker => {
            if (lastImportDeclaration) {
                changeTracker.insertNodeAfter(sourceFile, lastImportDeclaration, importDecl);
            }
            else {
                changeTracker.insertNodeAtTopOfFile(sourceFile, importDecl, /*blankLineBetween*/ true);
            }
        });

        // if this file doesn't have any import statements, insert an import statement and then insert a new line
        // between the only import statement and user code. Otherwise just insert the statement because chances
        // are there are already a new line seperating code and import statements.
        return createCodeAction(
            Diagnostics.Import_0_from_module_1,
            [symbolName, moduleSpecifierWithoutQuotes],
            changes,
            "NewImport",
            moduleSpecifierWithoutQuotes,
        );
    }

    function createStringLiteralWithQuoteStyle(sourceFile: SourceFile, text: string): StringLiteral {
        const literal = createLiteral(text);
        const firstModuleSpecifier = firstOrUndefined(sourceFile.imports);
        literal.singleQuote = !!firstModuleSpecifier && !isStringDoubleQuoted(firstModuleSpecifier, sourceFile);
        return literal;
    }

    function usesJsExtensionOnImports(sourceFile: SourceFile): boolean {
        return firstDefined(sourceFile.imports, ({ text }) => pathIsRelative(text) ? fileExtensionIs(text, Extension.Js) : undefined) || false;
    }

    function createImportClauseOfKind(kind: ImportKind.Default | ImportKind.Named | ImportKind.Namespace, symbolName: string) {
        const id = createIdentifier(symbolName);
        switch (kind) {
            case ImportKind.Default:
                return createImportClause(id, /*namedBindings*/ undefined);
            case ImportKind.Namespace:
                return createImportClause(/*name*/ undefined, createNamespaceImport(id));
            case ImportKind.Named:
                return createImportClause(/*name*/ undefined, createNamedImports([createImportSpecifier(/*propertyName*/ undefined, id)]));
            default:
                Debug.assertNever(kind);
        }
    }

    export function getModuleSpecifiersForNewImport(
        program: Program,
        sourceFile: SourceFile,
        moduleSymbols: ReadonlyArray<Symbol>,
        options: CompilerOptions,
        getCanonicalFileName: (file: string) => string,
        host: LanguageServiceHost,
    ): string[] {
        const { baseUrl, paths, rootDirs } = options;
        const addJsExtension = usesJsExtensionOnImports(sourceFile);
        const choicesForEachExportingModule = flatMap(moduleSymbols, moduleSymbol =>
            getAllModulePaths(program, moduleSymbol.valueDeclaration.getSourceFile()).map(moduleFileName => {
                const sourceDirectory = getDirectoryPath(sourceFile.fileName);
                const global = tryGetModuleNameFromAmbientModule(moduleSymbol)
                    || tryGetModuleNameFromTypeRoots(options, host, getCanonicalFileName, moduleFileName, addJsExtension)
                    || tryGetModuleNameAsNodeModule(options, moduleFileName, host, getCanonicalFileName, sourceDirectory)
                    || rootDirs && tryGetModuleNameFromRootDirs(rootDirs, moduleFileName, sourceDirectory, getCanonicalFileName);
                if (global) {
                    return [global];
                }

                const relativePath = removeExtensionAndIndexPostFix(getRelativePath(moduleFileName, sourceDirectory, getCanonicalFileName), options, addJsExtension);
                if (!baseUrl) {
                    return [relativePath];
                }

                const relativeToBaseUrl = getRelativePathIfInDirectory(moduleFileName, baseUrl, getCanonicalFileName);
                if (!relativeToBaseUrl) {
                    return [relativePath];
                }

                const importRelativeToBaseUrl = removeExtensionAndIndexPostFix(relativeToBaseUrl, options, addJsExtension);
                if (paths) {
                    const fromPaths = tryGetModuleNameFromPaths(removeFileExtension(relativeToBaseUrl), importRelativeToBaseUrl, paths);
                    if (fromPaths) {
                        return [fromPaths];
                    }
                }

                if (isPathRelativeToParent(relativeToBaseUrl)) {
                    return [relativePath];
                }

                /*
                Prefer a relative import over a baseUrl import if it doesn't traverse up to baseUrl.

                Suppose we have:
                    baseUrl = /base
                    sourceDirectory = /base/a/b
                    moduleFileName = /base/foo/bar
                Then:
                    relativePath = ../../foo/bar
                    getRelativePathNParents(relativePath) = 2
                    pathFromSourceToBaseUrl = ../../
                    getRelativePathNParents(pathFromSourceToBaseUrl) = 2
                    2 < 2 = false
                In this case we should prefer using the baseUrl path "/a/b" instead of the relative path "../../foo/bar".

                Suppose we have:
                    baseUrl = /base
                    sourceDirectory = /base/foo/a
                    moduleFileName = /base/foo/bar
                Then:
                    relativePath = ../a
                    getRelativePathNParents(relativePath) = 1
                    pathFromSourceToBaseUrl = ../../
                    getRelativePathNParents(pathFromSourceToBaseUrl) = 2
                    1 < 2 = true
                In this case we should prefer using the relative path "../a" instead of the baseUrl path "foo/a".
                */
                const pathFromSourceToBaseUrl = getRelativePath(baseUrl, sourceDirectory, getCanonicalFileName);
                const relativeFirst = getRelativePathNParents(relativePath) < getRelativePathNParents(pathFromSourceToBaseUrl);
                return relativeFirst ? [relativePath, importRelativeToBaseUrl] : [importRelativeToBaseUrl, relativePath];
            }));
        // Only return results for the re-export with the shortest possible path (and also give the other path even if that's long.)
        return best(arrayIterator(choicesForEachExportingModule), (a, b) => a[0].length < b[0].length);
    }

    /**
     * Looks for a existing imports that use symlinks to this module.
     * Only if no symlink is available, the real path will be used.
     */
    function getAllModulePaths(program: Program, { fileName }: SourceFile): ReadonlyArray<string> {
        const symlinks = mapDefined(program.getSourceFiles(), sf =>
            sf.resolvedModules && firstDefinedIterator(sf.resolvedModules.values(), res =>
                res && res.resolvedFileName === fileName ? res.originalPath : undefined));
        return symlinks.length === 0 ? [fileName] : symlinks;
    }

    function getRelativePathNParents(relativePath: string): number {
        let count = 0;
        for (let i = 0; i + 3 <= relativePath.length && relativePath.slice(i, i + 3) === "../"; i += 3) {
            count++;
        }
        return count;
    }

    function tryGetModuleNameFromAmbientModule(moduleSymbol: Symbol): string | undefined {
        const decl = moduleSymbol.valueDeclaration;
        if (isModuleDeclaration(decl) && isStringLiteral(decl.name)) {
            return decl.name.text;
        }
    }

    function tryGetModuleNameFromPaths(relativeToBaseUrlWithIndex: string, relativeToBaseUrl: string, paths: MapLike<ReadonlyArray<string>>): string | undefined {
        for (const key in paths) {
            for (const patternText of paths[key]) {
                const pattern = removeFileExtension(normalizePath(patternText));
                const indexOfStar = pattern.indexOf("*");
                if (indexOfStar === 0 && pattern.length === 1) {
                    continue;
                }
                else if (indexOfStar !== -1) {
                    const prefix = pattern.substr(0, indexOfStar);
                    const suffix = pattern.substr(indexOfStar + 1);
                    if (relativeToBaseUrl.length >= prefix.length + suffix.length &&
                        startsWith(relativeToBaseUrl, prefix) &&
                        endsWith(relativeToBaseUrl, suffix)) {
                        const matchedStar = relativeToBaseUrl.substr(prefix.length, relativeToBaseUrl.length - suffix.length);
                        return key.replace("*", matchedStar);
                    }
                }
                else if (pattern === relativeToBaseUrl || pattern === relativeToBaseUrlWithIndex) {
                    return key;
                }
            }
        }
    }

    function tryGetModuleNameFromRootDirs(rootDirs: ReadonlyArray<string>, moduleFileName: string, sourceDirectory: string, getCanonicalFileName: (file: string) => string): string | undefined {
        const normalizedTargetPath = getPathRelativeToRootDirs(moduleFileName, rootDirs, getCanonicalFileName);
        if (normalizedTargetPath === undefined) {
            return undefined;
        }

        const normalizedSourcePath = getPathRelativeToRootDirs(sourceDirectory, rootDirs, getCanonicalFileName);
        const relativePath = normalizedSourcePath !== undefined ? getRelativePath(normalizedTargetPath, normalizedSourcePath, getCanonicalFileName) : normalizedTargetPath;
        return removeFileExtension(relativePath);
    }

    function tryGetModuleNameFromTypeRoots(
        options: CompilerOptions,
        host: GetEffectiveTypeRootsHost,
        getCanonicalFileName: (file: string) => string,
        moduleFileName: string,
        addJsExtension: boolean,
    ): string | undefined {
        const roots = getEffectiveTypeRoots(options, host);
        return firstDefined(roots, unNormalizedTypeRoot => {
            const typeRoot = toPath(unNormalizedTypeRoot, /*basePath*/ undefined, getCanonicalFileName);
            if (startsWith(moduleFileName, typeRoot)) {
                return removeExtensionAndIndexPostFix(moduleFileName.substring(typeRoot.length + 1), options, addJsExtension);
            }
        });
    }

    function tryGetModuleNameAsNodeModule(
        options: CompilerOptions,
        moduleFileName: string,
        host: LanguageServiceHost,
        getCanonicalFileName: (file: string) => string,
        sourceDirectory: string,
    ): string | undefined {
        if (getEmitModuleResolutionKind(options) !== ModuleResolutionKind.NodeJs) {
            // nothing to do here
            return undefined;
        }

        const parts = getNodeModulePathParts(moduleFileName);

        if (!parts) {
            return undefined;
        }

        // Simplify the full file path to something that can be resolved by Node.

        // If the module could be imported by a directory name, use that directory's name
        let moduleSpecifier = getDirectoryOrExtensionlessFileName(moduleFileName);
        // Get a path that's relative to node_modules or the importing file's path
        moduleSpecifier = getNodeResolvablePath(moduleSpecifier);
        // If the module was found in @types, get the actual Node package name
        return getPackageNameFromAtTypesDirectory(moduleSpecifier);

        function getDirectoryOrExtensionlessFileName(path: string): string {
            // If the file is the main module, it can be imported by the package name
            const packageRootPath = path.substring(0, parts.packageRootIndex);
            const packageJsonPath = combinePaths(packageRootPath, "package.json");
            if (host.fileExists(packageJsonPath)) {
                const packageJsonContent = JSON.parse(host.readFile(packageJsonPath));
                if (packageJsonContent) {
                    const mainFileRelative = packageJsonContent.typings || packageJsonContent.types || packageJsonContent.main;
                    if (mainFileRelative) {
                        const mainExportFile = toPath(mainFileRelative, packageRootPath, getCanonicalFileName);
                        if (mainExportFile === getCanonicalFileName(path)) {
                            return packageRootPath;
                        }
                    }
                }
            }

            // We still have a file name - remove the extension
            const fullModulePathWithoutExtension = removeFileExtension(path);

            // If the file is /index, it can be imported by its directory name
            if (getCanonicalFileName(fullModulePathWithoutExtension.substring(parts.fileNameIndex)) === "/index") {
                return fullModulePathWithoutExtension.substring(0, parts.fileNameIndex);
            }

            return fullModulePathWithoutExtension;
        }

        function getNodeResolvablePath(path: string): string {
            const basePath = path.substring(0, parts.topLevelNodeModulesIndex);
            if (sourceDirectory.indexOf(basePath) === 0) {
                // if node_modules folder is in this folder or any of its parent folders, no need to keep it.
                return path.substring(parts.topLevelPackageNameIndex + 1);
            }
            else {
                return getRelativePath(path, sourceDirectory, getCanonicalFileName);
            }
        }
    }

    function getNodeModulePathParts(fullPath: string) {
        // If fullPath can't be valid module file within node_modules, returns undefined.
        // Example of expected pattern: /base/path/node_modules/[@scope/otherpackage/@otherscope/node_modules/]package/[subdirectory/]file.js
        // Returns indices:                       ^            ^                                                      ^             ^

        let topLevelNodeModulesIndex = 0;
        let topLevelPackageNameIndex = 0;
        let packageRootIndex = 0;
        let fileNameIndex = 0;

        const enum States {
            BeforeNodeModules,
            NodeModules,
            Scope,
            PackageContent
        }

        let partStart = 0;
        let partEnd = 0;
        let state = States.BeforeNodeModules;

        while (partEnd >= 0) {
            partStart = partEnd;
            partEnd = fullPath.indexOf("/", partStart + 1);
            switch (state) {
                case States.BeforeNodeModules:
                    if (fullPath.indexOf("/node_modules/", partStart) === partStart) {
                        topLevelNodeModulesIndex = partStart;
                        topLevelPackageNameIndex = partEnd;
                        state = States.NodeModules;
                    }
                    break;
                case States.NodeModules:
                case States.Scope:
                    if (state === States.NodeModules && fullPath.charAt(partStart + 1) === "@") {
                        state = States.Scope;
                    }
                    else {
                        packageRootIndex = partEnd;
                        state = States.PackageContent;
                    }
                    break;
                case States.PackageContent:
                    if (fullPath.indexOf("/node_modules/", partStart) === partStart) {
                        state = States.NodeModules;
                    }
                    else {
                        state = States.PackageContent;
                    }
                    break;
            }
        }

        fileNameIndex = partStart;

        return state > States.NodeModules ? { topLevelNodeModulesIndex, topLevelPackageNameIndex, packageRootIndex, fileNameIndex } : undefined;
    }

    function getPathRelativeToRootDirs(path: string, rootDirs: ReadonlyArray<string>, getCanonicalFileName: GetCanonicalFileName): string | undefined {
        return firstDefined(rootDirs, rootDir => {
            const relativePath = getRelativePathIfInDirectory(path, rootDir, getCanonicalFileName);
            return isPathRelativeToParent(relativePath) ? undefined : relativePath;
        });
    }

    function removeExtensionAndIndexPostFix(fileName: string, options: CompilerOptions, addJsExtension: boolean): string {
        const noExtension = removeFileExtension(fileName);
        return addJsExtension
            ? noExtension + ".js"
            : getEmitModuleResolutionKind(options) === ModuleResolutionKind.NodeJs
                ? removeSuffix(noExtension, "/index")
                : noExtension;
    }

    function getRelativePathIfInDirectory(path: string, directoryPath: string, getCanonicalFileName: GetCanonicalFileName): string | undefined {
        const relativePath = getRelativePathToDirectoryOrUrl(directoryPath, path, directoryPath, getCanonicalFileName, /*isAbsolutePathAnUrl*/ false);
        return isRootedDiskPath(relativePath) ? undefined : relativePath;
    }

    function isPathRelativeToParent(path: string): boolean {
        return startsWith(path, "..");
    }

    function getRelativePath(path: string, directoryPath: string, getCanonicalFileName: GetCanonicalFileName) {
        const relativePath = getRelativePathToDirectoryOrUrl(directoryPath, path, directoryPath, getCanonicalFileName, /*isAbsolutePathAnUrl*/ false);
        return !pathIsRelative(relativePath) ? "./" + relativePath : relativePath;
    }

    function getCodeActionsForAddImport(
        moduleSymbols: ReadonlyArray<Symbol>,
        ctx: ImportCodeFixOptions,
        declarations: ReadonlyArray<AnyImportSyntax>
    ): ImportCodeAction[] {
        const fromExistingImport = firstDefined(declarations, declaration => {
            if (declaration.kind === SyntaxKind.ImportDeclaration && declaration.importClause) {
                const changes = tryUpdateExistingImport(ctx, isImportClause(declaration.importClause) && declaration.importClause || undefined);
                if (changes) {
                    const moduleSpecifierWithoutQuotes = stripQuotes(declaration.moduleSpecifier.getText());
                    return createCodeAction(
                        Diagnostics.Add_0_to_existing_import_declaration_from_1,
                        [ctx.symbolName, moduleSpecifierWithoutQuotes],
                        changes,
                        "InsertingIntoExistingImport",
                        moduleSpecifierWithoutQuotes);
                }
            }
        });
        if (fromExistingImport) {
            return [fromExistingImport];
        }

        const existingDeclaration = firstDefined(declarations, moduleSpecifierFromAnyImport);
        const moduleSpecifiers = existingDeclaration ? [existingDeclaration] : getModuleSpecifiersForNewImport(ctx.program, ctx.sourceFile, moduleSymbols, ctx.compilerOptions, ctx.getCanonicalFileName, ctx.host);
        return moduleSpecifiers.map(spec => getCodeActionForNewImport(ctx, spec));
    }

    function moduleSpecifierFromAnyImport(node: AnyImportSyntax): string | undefined {
        const expression = node.kind === SyntaxKind.ImportDeclaration
            ? node.moduleSpecifier
            : node.moduleReference.kind === SyntaxKind.ExternalModuleReference
                ? node.moduleReference.expression
                : undefined;
        return expression && isStringLiteral(expression) ? expression.text : undefined;
    }

    function tryUpdateExistingImport(context: SymbolContext & { kind: ImportKind }, importClause: ImportClause | ImportEqualsDeclaration): FileTextChanges[] | undefined {
        const { symbolName, sourceFile, kind } = context;
        const { name } = importClause;
        const { namedBindings } = importClause.kind !== SyntaxKind.ImportEqualsDeclaration && importClause;
        switch (kind) {
            case ImportKind.Default:
                return name ? undefined : ChangeTracker.with(context, t =>
                    t.replaceNode(sourceFile, importClause, createImportClause(createIdentifier(symbolName), namedBindings)));

            case ImportKind.Named: {
                const newImportSpecifier = createImportSpecifier(/*propertyName*/ undefined, createIdentifier(symbolName));
                if (namedBindings && namedBindings.kind === SyntaxKind.NamedImports && namedBindings.elements.length !== 0) {
                    // There are already named imports; add another.
                    return ChangeTracker.with(context, t => t.insertNodeInListAfter(
                        sourceFile,
                        namedBindings.elements[namedBindings.elements.length - 1],
                        newImportSpecifier));
                }
                if (!namedBindings || namedBindings.kind === SyntaxKind.NamedImports && namedBindings.elements.length === 0) {
                    return ChangeTracker.with(context, t =>
                        t.replaceNode(sourceFile, importClause, createImportClause(name, createNamedImports([newImportSpecifier]))));
                }
                return undefined;
            }

            case ImportKind.Namespace:
                return namedBindings ? undefined : ChangeTracker.with(context, t =>
                    t.replaceNode(sourceFile, importClause, createImportClause(name, createNamespaceImport(createIdentifier(symbolName)))));

            case ImportKind.Equals:
                return undefined;

            default:
                Debug.assertNever(kind);
        }
    }

    function getCodeActionForUseExistingNamespaceImport(namespacePrefix: string, context: SymbolContext, symbolToken: Identifier): ImportCodeAction {
        const { symbolName, sourceFile } = context;

        /**
         * Cases:
         *     import * as ns from "mod"
         *     import default, * as ns from "mod"
         *     import ns = require("mod")
         *
         * Because there is no import list, we alter the reference to include the
         * namespace instead of altering the import declaration. For example, "foo" would
         * become "ns.foo"
         */
        // Prefix the node instead of it replacing it, because this may be used for import completions and we don't want the text changes to overlap with the identifier being completed.
        const changes = ChangeTracker.with(context, tracker =>
            tracker.changeIdentifierToPropertyAccess(sourceFile, namespacePrefix, symbolToken));
        return createCodeAction(Diagnostics.Change_0_to_1, [symbolName, `${namespacePrefix}.${symbolName}`], changes, "CodeChange", /*moduleSpecifier*/ undefined);
    }

    function getImportCodeActions(context: CodeFixContext): ImportCodeAction[] {
        const importFixContext = convertToImportCodeFixContext(context);
        return context.errorCode === Diagnostics._0_refers_to_a_UMD_global_but_the_current_file_is_a_module_Consider_adding_an_import_instead.code
            ? getActionsForUMDImport(importFixContext)
            : getActionsForNonUMDImport(importFixContext, context.program.getSourceFiles(), context.cancellationToken);
    }

    function getActionsForUMDImport(context: ImportCodeFixContext): ImportCodeAction[] {
        const { checker, symbolToken, compilerOptions } = context;
        const umdSymbol = checker.getSymbolAtLocation(symbolToken);
        let symbol: ts.Symbol;
        let symbolName: string;
        if (umdSymbol.flags & ts.SymbolFlags.Alias) {
            symbol = checker.getAliasedSymbol(umdSymbol);
            symbolName = context.symbolName;
        }
        else if (isJsxOpeningLikeElement(symbolToken.parent) && symbolToken.parent.tagName === symbolToken) {
            // The error wasn't for the symbolAtLocation, it was for the JSX tag itself, which needs access to e.g. `React`.
            symbol = checker.getAliasedSymbol(checker.resolveName(checker.getJsxNamespace(), symbolToken.parent.tagName, SymbolFlags.Value, /*excludeGlobals*/ false));
            symbolName = symbol.name;
        }
        else {
            throw Debug.fail("Either the symbol or the JSX namespace should be a UMD global if we got here");
        }

        return getCodeActionForImport(symbol, { ...context, symbolName, kind: getUmdImportKind(compilerOptions) });
    }
    function getUmdImportKind(compilerOptions: CompilerOptions) {
        // Import a synthetic `default` if enabled.
        if (getAllowSyntheticDefaultImports(compilerOptions)) {
            return ImportKind.Default;
        }

        // When a synthetic `default` is unavailable, use `import..require` if the module kind supports it.
        const moduleKind = getEmitModuleKind(compilerOptions);
        switch (moduleKind) {
            case ModuleKind.AMD:
            case ModuleKind.CommonJS:
            case ModuleKind.UMD:
                return ImportKind.Equals;
            case ModuleKind.System:
            case ModuleKind.ES2015:
            case ModuleKind.ESNext:
            case ModuleKind.None:
                // Fall back to the `import * as ns` style import.
                return ImportKind.Namespace;
            default:
                throw Debug.assertNever(moduleKind);
        }
    }

    function getActionsForNonUMDImport(context: ImportCodeFixContext, allSourceFiles: ReadonlyArray<SourceFile>, cancellationToken: CancellationToken): ImportCodeAction[] {
        const { sourceFile, checker, symbolName, symbolToken } = context;
        // "default" is a keyword and not a legal identifier for the import, so we don't expect it here
        Debug.assert(symbolName !== "default");
        const symbolIdActionMap = new ImportCodeActionMap();
        const currentTokenMeaning = getMeaningFromLocation(symbolToken);

        forEachExternalModuleToImportFrom(checker, sourceFile, allSourceFiles, moduleSymbol => {
            cancellationToken.throwIfCancellationRequested();
            // check the default export
            const defaultExport = checker.tryGetMemberInModuleExports(InternalSymbolName.Default, moduleSymbol);
            if (defaultExport) {
                const localSymbol = getLocalSymbolForExportDefault(defaultExport);
                if ((
                        localSymbol && localSymbol.escapedName === symbolName ||
                        getEscapedNameForExportDefault(defaultExport) === symbolName ||
                        moduleSymbolToValidIdentifier(moduleSymbol, context.compilerOptions.target) === symbolName
                    ) && checkSymbolHasMeaning(localSymbol || defaultExport, currentTokenMeaning)) {
                    // check if this symbol is already used
                    const symbolId = getUniqueSymbolId(localSymbol || defaultExport, checker);
                    symbolIdActionMap.addActions(symbolId, getCodeActionForImport(moduleSymbol, { ...context, kind: ImportKind.Default }));
                }
            }

            // check exports with the same name
            const exportSymbolWithIdenticalName = checker.tryGetMemberInModuleExportsAndProperties(symbolName, moduleSymbol);
            if (exportSymbolWithIdenticalName && checkSymbolHasMeaning(exportSymbolWithIdenticalName, currentTokenMeaning)) {
                const symbolId = getUniqueSymbolId(exportSymbolWithIdenticalName, checker);
                symbolIdActionMap.addActions(symbolId, getCodeActionForImport(moduleSymbol, { ...context, kind: ImportKind.Named }));
            }

            function getEscapedNameForExportDefault(symbol: Symbol): __String | undefined {
                return firstDefined(symbol.declarations, declaration => {
                    if (isExportAssignment(declaration)) {
                        if (isIdentifier(declaration.expression)) {
                            return declaration.expression.escapedText;
                        }
                    }
                    else if (isExportSpecifier(declaration)) {
                        Debug.assert(declaration.name.escapedText === InternalSymbolName.Default);
                        if (declaration.propertyName) {
                            return declaration.propertyName.escapedText;
                        }
                    }
                });
            }
        });

        return symbolIdActionMap.getAllActions();
    }

    function checkSymbolHasMeaning({ declarations }: Symbol, meaning: SemanticMeaning): boolean {
        return some(declarations, decl => !!(getMeaningFromDeclaration(decl) & meaning));
    }

    export function forEachExternalModuleToImportFrom(checker: TypeChecker, from: SourceFile, allSourceFiles: ReadonlyArray<SourceFile>, cb: (module: Symbol) => void) {
        forEachExternalModule(checker, allSourceFiles, (module, sourceFile) => {
            if (sourceFile === undefined || sourceFile !== from && isImportablePath(from.fileName, sourceFile.fileName)) {
                cb(module);
            }
        });
    }

    export function forEachExternalModule(checker: TypeChecker, allSourceFiles: ReadonlyArray<SourceFile>, cb: (module: Symbol, sourceFile: SourceFile | undefined) => void) {
        for (const ambient of checker.getAmbientModules()) {
            cb(ambient, /*sourceFile*/ undefined);
        }
        for (const sourceFile of allSourceFiles) {
            if (isExternalOrCommonJsModule(sourceFile)) {
                cb(sourceFile.symbol, sourceFile);
            }
        }
    }

    /**
     * Don't include something from a `node_modules` that isn't actually reachable by a global import.
     * A relative import to node_modules is usually a bad idea.
     */
    function isImportablePath(fromPath: string, toPath: string): boolean {
        // If it's in a `node_modules` but is not reachable from here via a global import, don't bother.
        const toNodeModules = forEachAncestorDirectory(toPath, ancestor => getBaseFileName(ancestor) === "node_modules" ? ancestor : undefined);
        return toNodeModules === undefined || startsWith(fromPath, getDirectoryPath(toNodeModules));
    }

    export function moduleSymbolToValidIdentifier(moduleSymbol: Symbol, target: ScriptTarget): string {
        return moduleSpecifierToValidIdentifier(removeFileExtension(getBaseFileName(moduleSymbol.name)), target);
    }

    export function moduleSpecifierToValidIdentifier(moduleSpecifier: string, target: ScriptTarget): string {
        let res = "";
        let lastCharWasValid = true;
        const firstCharCode = moduleSpecifier.charCodeAt(0);
        if (isIdentifierStart(firstCharCode, target)) {
            res += String.fromCharCode(firstCharCode);
        }
        else {
            lastCharWasValid = false;
        }
        for (let i = 1; i < moduleSpecifier.length; i++) {
            const ch = moduleSpecifier.charCodeAt(i);
            const isValid = isIdentifierPart(ch, target);
            if (isValid) {
                let char = String.fromCharCode(ch);
                if (!lastCharWasValid) {
                    char = char.toUpperCase();
                }
                res += char;
            }
            lastCharWasValid = isValid;
        }
        // Need `|| "_"` to ensure result isn't empty.
        return !isStringANonContextualKeyword(res) ? res || "_" : `_${res}`;
    }
}
