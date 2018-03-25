/// <reference path="./pathCompletions.ts" />

/* @internal */
namespace ts.Completions {
    export type Log = (message: string) => void;

    type SymbolOriginInfo = { type: "this-type" } | SymbolOriginInfoExport;
    interface SymbolOriginInfoExport {
        type: "export";
        moduleSymbol: Symbol;
        isDefaultExport: boolean;
    }
    /**
     * Map from symbol id -> SymbolOriginInfo.
     * Only populated for symbols that come from other modules.
     */
    type SymbolOriginInfoMap = (SymbolOriginInfo | undefined)[];

    const enum KeywordCompletionFilters {
        None,
        ClassElementKeywords,           // Keywords at class keyword
        ConstructorParameterKeywords,   // Keywords at constructor parameter
        FunctionLikeBodyKeywords,       // Keywords at function like body
        TypeKeywords,
    }

    export function getCompletionsAtPosition(
        host: LanguageServiceHost,
        typeChecker: TypeChecker,
        log: Log,
        compilerOptions: CompilerOptions,
        sourceFile: SourceFile,
        position: number,
        allSourceFiles: ReadonlyArray<SourceFile>,
        options: GetCompletionsAtPositionOptions,
    ): CompletionInfo | undefined {
        if (isInReferenceComment(sourceFile, position)) {
            const entries = PathCompletions.getTripleSlashReferenceCompletion(sourceFile, position, compilerOptions, host);
            return entries && pathCompletionsInfo(entries);
        }

        const contextToken = findPrecedingToken(position, sourceFile);

        if (isInString(sourceFile, position, contextToken)) {
            return !contextToken || !isStringLiteral(contextToken) && !isNoSubstitutionTemplateLiteral(contextToken)
                ? undefined
                : getStringLiteralCompletionEntries(sourceFile, contextToken, position, typeChecker, compilerOptions, host, log);
        }

        if (contextToken && isBreakOrContinueStatement(contextToken.parent)
            && (contextToken.kind === SyntaxKind.BreakKeyword || contextToken.kind === SyntaxKind.ContinueKeyword || contextToken.kind === SyntaxKind.Identifier)) {
            return getLabelCompletionAtPosition(contextToken.parent);
        }

        const completionData = getCompletionData(typeChecker, log, sourceFile, position, allSourceFiles, options, compilerOptions.target);
        if (!completionData) {
            return undefined;
        }

        switch (completionData.kind) {
            case CompletionDataKind.Data:
                return completionInfoFromData(sourceFile, typeChecker, compilerOptions, log, completionData, options.includeInsertTextCompletions);
            case CompletionDataKind.JsDocTagName:
                // If the current position is a jsDoc tag name, only tag names should be provided for completion
                return jsdocCompletionInfo(JsDoc.getJSDocTagNameCompletions());
            case CompletionDataKind.JsDocTag:
                // If the current position is a jsDoc tag, only tags should be provided for completion
                return jsdocCompletionInfo(JsDoc.getJSDocTagCompletions());
            case CompletionDataKind.JsDocParameterName:
                return jsdocCompletionInfo(JsDoc.getJSDocParameterNameCompletions(completionData.tag));
            default:
                throw Debug.assertNever(completionData);
        }
    }

    function jsdocCompletionInfo(entries: CompletionEntry[]): CompletionInfo {
        return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries };
    }

    function completionInfoFromData(sourceFile: SourceFile, typeChecker: TypeChecker, compilerOptions: CompilerOptions, log: Log, completionData: CompletionData, includeInsertTextCompletions: boolean): CompletionInfo {
        const { symbols, completionKind, isNewIdentifierLocation, location, propertyAccessToConvert, keywordFilters, symbolToOriginInfoMap, recommendedCompletion, isJsxInitializer } = completionData;

        if (sourceFile.languageVariant === LanguageVariant.JSX && location && location.parent && isJsxClosingElement(location.parent)) {
            // In the TypeScript JSX element, if such element is not defined. When users query for completion at closing tag,
            // instead of simply giving unknown value, the completion will return the tag-name of an associated opening-element.
            // For example:
            //     var x = <div> </ /*1*/>
            // The completion list at "1" will contain "div" with type any
            const tagName = location.parent.parent.openingElement.tagName;
            return { isGlobalCompletion: false, isMemberCompletion: true, isNewIdentifierLocation: false,
                entries: [{
                    name: tagName.getFullText(),
                    kind: ScriptElementKind.classElement,
                    kindModifiers: undefined,
                    sortText: "0",
                }]};
        }

        const entries: CompletionEntry[] = [];

        if (isSourceFileJavaScript(sourceFile)) {
            const uniqueNames = getCompletionEntriesFromSymbols(symbols, entries, location, sourceFile, typeChecker, compilerOptions.target, log, completionKind, includeInsertTextCompletions, propertyAccessToConvert, isJsxInitializer, recommendedCompletion, symbolToOriginInfoMap);
            getJavaScriptCompletionEntries(sourceFile, location.pos, uniqueNames, compilerOptions.target, entries);
        }
        else {
            if ((!symbols || symbols.length === 0) && keywordFilters === KeywordCompletionFilters.None) {
                return undefined;
            }

            getCompletionEntriesFromSymbols(symbols, entries, location, sourceFile, typeChecker, compilerOptions.target, log, completionKind, includeInsertTextCompletions, propertyAccessToConvert, isJsxInitializer, recommendedCompletion, symbolToOriginInfoMap);
        }

        // TODO add filter for keyword based on type/value/namespace and also location

        // Add all keywords if
        // - this is not a member completion list (all the keywords)
        // - other filters are enabled in required scenario so add those keywords
        const isMemberCompletion = isMemberCompletionKind(completionKind);
        if (keywordFilters !== KeywordCompletionFilters.None || !isMemberCompletion) {
            addRange(entries, getKeywordCompletions(keywordFilters));
        }

        return { isGlobalCompletion: completionKind === CompletionKind.Global, isMemberCompletion, isNewIdentifierLocation, entries };
    }

    function isMemberCompletionKind(kind: CompletionKind): boolean {
        switch (kind) {
            case CompletionKind.ObjectPropertyDeclaration:
            case CompletionKind.MemberLike:
            case CompletionKind.PropertyAccess:
                return true;
            default:
                return false;
        }
    }

    function getJavaScriptCompletionEntries(
        sourceFile: SourceFile,
        position: number,
        uniqueNames: Map<true>,
        target: ScriptTarget,
        entries: Push<CompletionEntry>): void {
        getNameTable(sourceFile).forEach((pos, name) => {
            // Skip identifiers produced only from the current location
            if (pos === position) {
                return;
            }
            const realName = unescapeLeadingUnderscores(name);
            if (addToSeen(uniqueNames, realName) && isIdentifierText(realName, target) && !isStringANonContextualKeyword(realName)) {
                entries.push({
                    name: realName,
                    kind: ScriptElementKind.warning,
                    kindModifiers: "",
                    sortText: "1"
                });
            }
        });
    }

    function createCompletionEntry(
        symbol: Symbol,
        location: Node,
        sourceFile: SourceFile,
        typeChecker: TypeChecker,
        target: ScriptTarget,
        kind: CompletionKind,
        origin: SymbolOriginInfo | undefined,
        recommendedCompletion: Symbol | undefined,
        propertyAccessToConvert: PropertyAccessExpression | undefined,
        isJsxInitializer: IsJsxInitializer,
        includeInsertTextCompletions: boolean,
    ): CompletionEntry | undefined {
        const info = getCompletionEntryDisplayNameForSymbol(symbol, target, origin, kind);
        if (!info) {
            return undefined;
        }
        const { name, needsConvertPropertyAccess } = info;

        let insertText: string | undefined;
        let replacementSpan: TextSpan | undefined;
        if (includeInsertTextCompletions) {
            if (origin && origin.type === "this-type") {
                insertText = needsConvertPropertyAccess ? `this[${quote(name)}]` : `this.${name}`;
            }
            else if (needsConvertPropertyAccess) {
                insertText = `[${quote(name)}]`;
                const dot = findChildOfKind(propertyAccessToConvert!, SyntaxKind.DotToken, sourceFile)!;
                // If the text after the '.' starts with this name, write over it. Else, add new text.
                const end = startsWith(name, propertyAccessToConvert!.name.text) ? propertyAccessToConvert!.name.end : dot.end;
                replacementSpan = createTextSpanFromBounds(dot.getStart(sourceFile), end);
            }

            if (isJsxInitializer) {
                if (insertText === undefined) insertText = name;
                insertText = `{${insertText}}`;
                if (typeof isJsxInitializer !== "boolean") {
                    replacementSpan = createTextSpanFromNode(isJsxInitializer, sourceFile);
                }
            }
        }

        if (insertText !== undefined && !includeInsertTextCompletions) {
            return undefined;
        }

        // TODO(drosen): Right now we just permit *all* semantic meanings when calling
        // 'getSymbolKind' which is permissible given that it is backwards compatible; but
        // really we should consider passing the meaning for the node so that we don't report
        // that a suggestion for a value is an interface.  We COULD also just do what
        // 'getSymbolModifiers' does, which is to use the first declaration.

        // Use a 'sortText' of 0' so that all symbol completion entries come before any other
        // entries (like JavaScript identifier entries).
        return {
            name,
            kind: SymbolDisplay.getSymbolKind(typeChecker, symbol, location),
            kindModifiers: SymbolDisplay.getSymbolModifiers(symbol),
            sortText: "0",
            source: getSourceFromOrigin(origin),
            hasAction: trueOrUndefined(!!origin && origin.type === "export"),
            isRecommended: trueOrUndefined(isRecommendedCompletionMatch(symbol, recommendedCompletion, typeChecker)),
            insertText,
            replacementSpan,
        };
    }

    function quote(text: string): string {
        // TODO: GH#20619 Use configured quote style
        return JSON.stringify(text);
    }

    function isRecommendedCompletionMatch(localSymbol: Symbol, recommendedCompletion: Symbol, checker: TypeChecker): boolean {
        return localSymbol === recommendedCompletion ||
            !!(localSymbol.flags & SymbolFlags.ExportValue) && checker.getExportSymbolOfSymbol(localSymbol) === recommendedCompletion;
    }

    function trueOrUndefined(b: boolean): true | undefined {
        return b ? true : undefined;
    }

    function getSourceFromOrigin(origin: SymbolOriginInfo | undefined): string | undefined {
        return origin && origin.type === "export" ? stripQuotes(origin.moduleSymbol.name) : undefined;
    }

    function getCompletionEntriesFromSymbols(
        symbols: ReadonlyArray<Symbol>,
        entries: Push<CompletionEntry>,
        location: Node,
        sourceFile: SourceFile,
        typeChecker: TypeChecker,
        target: ScriptTarget,
        log: Log,
        kind: CompletionKind,
        includeInsertTextCompletions?: boolean,
        propertyAccessToConvert?: PropertyAccessExpression | undefined,
        isJsxInitializer?: IsJsxInitializer,
        recommendedCompletion?: Symbol,
        symbolToOriginInfoMap?: SymbolOriginInfoMap,
    ): Map<true> {
        const start = timestamp();
        // Tracks unique names.
        // We don't set this for global variables or completions from external module exports, because we can have multiple of those.
        // Based on the order we add things we will always see locals first, then globals, then module exports.
        // So adding a completion for a local will prevent us from adding completions for external module exports sharing the same name.
        const uniques = createMap<true>();
        for (const symbol of symbols) {
            const origin = symbolToOriginInfoMap ? symbolToOriginInfoMap[getSymbolId(symbol)] : undefined;
            const entry = createCompletionEntry(symbol, location, sourceFile, typeChecker, target, kind, origin, recommendedCompletion, propertyAccessToConvert, isJsxInitializer, includeInsertTextCompletions);
            if (!entry) {
                continue;
            }

            const { name } = entry;
            if (uniques.has(name)) {
                continue;
            }

            // Latter case tests whether this is a global variable.
            if (!origin && !(symbol.parent === undefined && !some(symbol.declarations, d => d.getSourceFile() === location.getSourceFile()))) {
                uniques.set(name, true);
            }

            entries.push(entry);
        }

        log("getCompletionsAtPosition: getCompletionEntriesFromSymbols: " + (timestamp() - start));
        return uniques;
    }

    function getLabelCompletionAtPosition(node: BreakOrContinueStatement): CompletionInfo | undefined {
        const entries = getLabelStatementCompletions(node);
        if (entries.length) {
            return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries };
        }
    }

    function getStringLiteralCompletionEntries(sourceFile: SourceFile, node: StringLiteralLike, position: number, typeChecker: TypeChecker, compilerOptions: CompilerOptions, host: LanguageServiceHost, log: Log): CompletionInfo | undefined {
        switch (node.parent.kind) {
            case SyntaxKind.LiteralType:
                switch (node.parent.parent.kind) {
                    case SyntaxKind.TypeReference:
                        // TODO: GH#21168
                        return undefined;
                    case SyntaxKind.IndexedAccessType:
                        // Get all apparent property names
                        // i.e. interface Foo {
                        //          foo: string;
                        //          bar: string;
                        //      }
                        //      let x: Foo["/*completion position*/"]
                        const type = typeChecker.getTypeFromTypeNode((node.parent.parent as IndexedAccessTypeNode).objectType);
                        return getStringLiteralCompletionEntriesFromElementAccessOrIndexedAccess(node, sourceFile, type, typeChecker, compilerOptions.target, log);
                    default:
                        return undefined;
                }

            case SyntaxKind.PropertyAssignment:
                if (node.parent.parent.kind === SyntaxKind.ObjectLiteralExpression &&
                    (<PropertyAssignment>node.parent).name === node) {
                    // Get quoted name of properties of the object literal expression
                    // i.e. interface ConfigFiles {
                    //          'jspm:dev': string
                    //      }
                    //      let files: ConfigFiles = {
                    //          '/*completion position*/'
                    //      }
                    //
                    //      function foo(c: ConfigFiles) {}
                    //      foo({
                    //          '/*completion position*/'
                    //      });
                    return getStringLiteralCompletionEntriesFromPropertyAssignment(<PropertyAssignment>node.parent, sourceFile, typeChecker, compilerOptions.target, log);
                }
                return fromContextualType();

            case SyntaxKind.ElementAccessExpression: {
                const { expression, argumentExpression } = node.parent as ElementAccessExpression;
                if (node === argumentExpression) {
                    // Get all names of properties on the expression
                    // i.e. interface A {
                    //      'prop1': string
                    // }
                    // let a: A;
                    // a['/*completion position*/']
                    const type = typeChecker.getTypeAtLocation(expression);
                    return getStringLiteralCompletionEntriesFromElementAccessOrIndexedAccess(node, sourceFile, type, typeChecker, compilerOptions.target, log);
                }
                break;
            }

            case SyntaxKind.CallExpression:
            case SyntaxKind.NewExpression:
                if (!isRequireCall(node.parent, /*checkArgumentIsStringLiteral*/ false) && !isImportCall(node.parent)) {
                    const argumentInfo = SignatureHelp.getImmediatelyContainingArgumentInfo(node, position, sourceFile);
                    // Get string literal completions from specialized signatures of the target
                    // i.e. declare function f(a: 'A');
                    // f("/*completion position*/")
                    return argumentInfo ? getStringLiteralCompletionEntriesFromCallExpression(argumentInfo, typeChecker) : fromContextualType();
                }
                // falls through

            case SyntaxKind.ImportDeclaration:
            case SyntaxKind.ExportDeclaration:
            case SyntaxKind.ExternalModuleReference:
                // Get all known external module names or complete a path to a module
                // i.e. import * as ns from "/*completion position*/";
                //      var y = import("/*completion position*/");
                //      import x = require("/*completion position*/");
                //      var y = require("/*completion position*/");
                //      export * from "/*completion position*/";
                return pathCompletionsInfo(PathCompletions.getStringLiteralCompletionsFromModuleNames(sourceFile, node, compilerOptions, host, typeChecker));

            default:
                return fromContextualType();
        }

        function fromContextualType(): CompletionInfo {
            // Get completion for string literal from string literal type
            // i.e. var x: "hi" | "hello" = "/*completion position*/"
            return getStringLiteralCompletionEntriesFromType(getContextualTypeFromParent(node, typeChecker), typeChecker);
        }
    }

    function pathCompletionsInfo(entries: CompletionEntry[]): CompletionInfo {
        return {
            // We don't want the editor to offer any other completions, such as snippets, inside a comment.
            isGlobalCompletion: false,
            isMemberCompletion: false,
            // The user may type in a path that doesn't yet exist, creating a "new identifier"
            // with respect to the collection of identifiers the server is aware of.
            isNewIdentifierLocation: true,
            entries,
        };
    }

    function getStringLiteralCompletionEntriesFromPropertyAssignment(element: ObjectLiteralElement, sourceFile: SourceFile, typeChecker: TypeChecker, target: ScriptTarget, log: Log): CompletionInfo | undefined {
        const type = typeChecker.getContextualType((<ObjectLiteralExpression>element.parent));
        const entries: CompletionEntry[] = [];
        if (type) {
            getCompletionEntriesFromSymbols(type.getApparentProperties(), entries, element, sourceFile, typeChecker, target, log, CompletionKind.String);
            if (entries.length) {
                return { isGlobalCompletion: false, isMemberCompletion: true, isNewIdentifierLocation: true, entries };
            }
        }
    }

    function getStringLiteralCompletionEntriesFromCallExpression(argumentInfo: SignatureHelp.ArgumentListInfo, typeChecker: TypeChecker): CompletionInfo | undefined {
        const candidates: Signature[] = [];
        const entries: CompletionEntry[] = [];
        const uniques = createMap<true>();

        typeChecker.getResolvedSignature(argumentInfo.invocation, candidates, argumentInfo.argumentCount);

        for (const candidate of candidates) {
            addStringLiteralCompletionsFromType(typeChecker.getParameterType(candidate, argumentInfo.argumentIndex), entries, typeChecker, uniques);
        }

        if (entries.length) {
            return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: true, entries };
        }

        return undefined;
    }

    function getStringLiteralCompletionEntriesFromElementAccessOrIndexedAccess(stringLiteralNode: StringLiteral | NoSubstitutionTemplateLiteral, sourceFile: SourceFile, type: Type, typeChecker: TypeChecker, target: ScriptTarget, log: Log): CompletionInfo | undefined {
        const entries: CompletionEntry[] = [];
        if (type) {
            getCompletionEntriesFromSymbols(type.getApparentProperties(), entries, stringLiteralNode, sourceFile, typeChecker, target, log, CompletionKind.String);
            if (entries.length) {
                return { isGlobalCompletion: false, isMemberCompletion: true, isNewIdentifierLocation: true, entries };
            }
        }
        return undefined;
    }

    function getStringLiteralCompletionEntriesFromType(type: Type, typeChecker: TypeChecker): CompletionInfo | undefined {
        if (type) {
            const entries: CompletionEntry[] = [];
            addStringLiteralCompletionsFromType(type, entries, typeChecker);
            if (entries.length) {
                return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries };
            }
        }
        return undefined;
    }

    function getLabelStatementCompletions(node: Node): CompletionEntry[] {
        const entries: CompletionEntry[] = [];
        const uniques = createMap<true>();
        let current = node;

        while (current) {
            if (isFunctionLike(current)) {
                break;
            }
            if (isLabeledStatement(current)) {
                const name = current.label.text;
                if (!uniques.has(name)) {
                    uniques.set(name, true);
                    entries.push({
                        name,
                        kindModifiers: ScriptElementKindModifier.none,
                        kind: ScriptElementKind.label,
                        sortText: "0"
                    });
                }
            }
            current = current.parent;
        }
        return entries;
    }

    function addStringLiteralCompletionsFromType(type: Type, result: Push<CompletionEntry>, typeChecker: TypeChecker, uniques = createMap<true>()): void {
        if (type && type.flags & TypeFlags.TypeParameter) {
            type = typeChecker.getBaseConstraintOfType(type);
        }
        if (!type) {
            return;
        }
        if (type.flags & TypeFlags.Union) {
            for (const t of (<UnionType>type).types) {
                addStringLiteralCompletionsFromType(t, result, typeChecker, uniques);
            }
        }
        else if (type.flags & TypeFlags.StringLiteral && !(type.flags & TypeFlags.EnumLiteral)) {
            const name = (<StringLiteralType>type).value;
            if (!uniques.has(name)) {
                uniques.set(name, true);
                result.push({
                    name,
                    kindModifiers: ScriptElementKindModifier.none,
                    kind: ScriptElementKind.variableElement,
                    sortText: "0"
                });
            }
        }
    }

    interface SymbolCompletion {
        type: "symbol";
        symbol: Symbol;
        location: Node;
        symbolToOriginInfoMap: SymbolOriginInfoMap;
        previousToken: Node;
        readonly isJsxInitializer: IsJsxInitializer;
    }
    function getSymbolCompletionFromEntryId(
        typeChecker: TypeChecker,
        log: (message: string) => void,
        compilerOptions: CompilerOptions,
        sourceFile: SourceFile,
        position: number,
        { name, source }: CompletionEntryIdentifier,
        allSourceFiles: ReadonlyArray<SourceFile>,
    ): SymbolCompletion | { type: "request", request: Request } | { type: "none" } {
        const completionData = getCompletionData(typeChecker, log, sourceFile, position, allSourceFiles, { includeExternalModuleExports: true, includeInsertTextCompletions: true }, compilerOptions.target);
        if (!completionData) {
            return { type: "none" };
        }
        if (completionData.kind !== CompletionDataKind.Data) {
            return { type: "request", request: completionData };
        }

        const { symbols, location, completionKind, symbolToOriginInfoMap, previousToken, isJsxInitializer } = completionData;

        // Find the symbol with the matching entry name.
        // We don't need to perform character checks here because we're only comparing the
        // name against 'entryName' (which is known to be good), not building a new
        // completion entry.
        return firstDefined<Symbol, SymbolCompletion>(symbols, (symbol): SymbolCompletion => { // TODO: Shouldn't need return type annotation (GH#12632)
            const origin = symbolToOriginInfoMap[getSymbolId(symbol)];
            const info = getCompletionEntryDisplayNameForSymbol(symbol, compilerOptions.target, origin, completionKind);
            return info && info.name === name && getSourceFromOrigin(origin) === source ? { type: "symbol" as "symbol", symbol, location, symbolToOriginInfoMap, previousToken, isJsxInitializer } : undefined;
        }) || { type: "none" };
    }

    function getSymbolName(symbol: Symbol, origin: SymbolOriginInfo | undefined, target: ScriptTarget): string {
        return origin && origin.type === "export" && origin.isDefaultExport && symbol.escapedName === InternalSymbolName.Default
            // Name of "export default foo;" is "foo". Name of "export default 0" is the filename converted to camelCase.
            ? firstDefined(symbol.declarations, d => isExportAssignment(d) && isIdentifier(d.expression) ? d.expression.text : undefined)
                || codefix.moduleSymbolToValidIdentifier(origin.moduleSymbol, target)
            : symbol.name;
    }

    export interface CompletionEntryIdentifier {
        name: string;
        source?: string;
    }

    export function getCompletionEntryDetails(
        program: Program,
        log: (message: string) => void,
        compilerOptions: CompilerOptions,
        sourceFile: SourceFile,
        position: number,
        entryId: CompletionEntryIdentifier,
        allSourceFiles: ReadonlyArray<SourceFile>,
        host: LanguageServiceHost,
        formatContext: formatting.FormatContext,
        getCanonicalFileName: GetCanonicalFileName,
    ): CompletionEntryDetails {
        const typeChecker = program.getTypeChecker();
        const { name } = entryId;
        // Compute all the completion symbols again.
        const symbolCompletion = getSymbolCompletionFromEntryId(typeChecker, log, compilerOptions, sourceFile, position, entryId, allSourceFiles);
        switch (symbolCompletion.type) {
            case "request": {
                const { request } = symbolCompletion;
                switch (request.kind) {
                    case CompletionDataKind.JsDocTagName:
                        return JsDoc.getJSDocTagNameCompletionDetails(name);
                    case CompletionDataKind.JsDocTag:
                        return JsDoc.getJSDocTagCompletionDetails(name);
                    case CompletionDataKind.JsDocParameterName:
                        return JsDoc.getJSDocParameterNameCompletionDetails(name);
                    default:
                        return Debug.assertNever(request);
                }
            }
            case "symbol": {
                const { symbol, location, symbolToOriginInfoMap, previousToken } = symbolCompletion;
                const { codeActions, sourceDisplay } = getCompletionEntryCodeActionsAndSourceDisplay(symbolToOriginInfoMap, symbol, program, typeChecker, host, compilerOptions, sourceFile, previousToken, formatContext, getCanonicalFileName, allSourceFiles);
                const kindModifiers = SymbolDisplay.getSymbolModifiers(symbol);
                const { displayParts, documentation, symbolKind, tags } = SymbolDisplay.getSymbolDisplayPartsDocumentationAndSymbolKind(typeChecker, symbol, sourceFile, location, location, SemanticMeaning.All);
                return { name, kindModifiers, kind: symbolKind, displayParts, documentation, tags, codeActions, source: sourceDisplay };
            }
            case "none": {
                // Didn't find a symbol with this name.  See if we can find a keyword instead.
                if (allKeywordsCompletions().some(c => c.name === name)) {
                    return {
                        name,
                        kind: ScriptElementKind.keyword,
                        kindModifiers: ScriptElementKindModifier.none,
                        displayParts: [displayPart(name, SymbolDisplayPartKind.keyword)],
                        documentation: undefined,
                        tags: undefined,
                        codeActions: undefined,
                        source: undefined,
                    };
                }
                return undefined;
            }
        }
    }

    interface CodeActionsAndSourceDisplay {
        readonly codeActions: CodeAction[] | undefined;
        readonly sourceDisplay: SymbolDisplayPart[] | undefined;
    }
    function getCompletionEntryCodeActionsAndSourceDisplay(
        symbolToOriginInfoMap: SymbolOriginInfoMap,
        symbol: Symbol,
        program: Program,
        checker: TypeChecker,
        host: LanguageServiceHost,
        compilerOptions: CompilerOptions,
        sourceFile: SourceFile,
        previousToken: Node,
        formatContext: formatting.FormatContext,
        getCanonicalFileName: GetCanonicalFileName,
        allSourceFiles: ReadonlyArray<SourceFile>,
    ): CodeActionsAndSourceDisplay {
        const symbolOriginInfo = symbolToOriginInfoMap[getSymbolId(symbol)];
        return symbolOriginInfo && symbolOriginInfo.type === "export"
            ? getCodeActionsAndSourceDisplayForImport(symbolOriginInfo, symbol, program, checker, host, compilerOptions, sourceFile, previousToken, formatContext, getCanonicalFileName, allSourceFiles)
            : { codeActions: undefined, sourceDisplay: undefined };
    }

    function getCodeActionsAndSourceDisplayForImport(
        symbolOriginInfo: SymbolOriginInfoExport,
        symbol: Symbol,
        program: Program,
        checker: TypeChecker,
        host: LanguageServiceHost,
        compilerOptions: CompilerOptions,
        sourceFile: SourceFile,
        previousToken: Node,
        formatContext: formatting.FormatContext,
        getCanonicalFileName: GetCanonicalFileName,
        allSourceFiles: ReadonlyArray<SourceFile>
    ): CodeActionsAndSourceDisplay {
        const { moduleSymbol, isDefaultExport } = symbolOriginInfo;
        const exportedSymbol = skipAlias(symbol.exportSymbol || symbol, checker);
        const moduleSymbols = getAllReExportingModules(exportedSymbol, checker, allSourceFiles);
        Debug.assert(contains(moduleSymbols, moduleSymbol));

        const sourceDisplay = [textPart(first(codefix.getModuleSpecifiersForNewImport(program, sourceFile, moduleSymbols, compilerOptions, getCanonicalFileName, host)))];
        const codeActions = codefix.getCodeActionForImport(moduleSymbols, {
            host,
            program,
            checker,
            compilerOptions,
            sourceFile,
            formatContext,
            symbolName: getSymbolName(symbol, symbolOriginInfo, compilerOptions.target),
            getCanonicalFileName,
            symbolToken: tryCast(previousToken, isIdentifier),
            kind: isDefaultExport ? codefix.ImportKind.Default : codefix.ImportKind.Named,
        }).slice(0, 1); // Only take the first code action
        return { sourceDisplay, codeActions };
    }

    function getAllReExportingModules(exportedSymbol: Symbol, checker: TypeChecker, allSourceFiles: ReadonlyArray<SourceFile>): ReadonlyArray<Symbol> {
        const result: Symbol[] = [];
        codefix.forEachExternalModule(checker, allSourceFiles, module => {
            for (const exported of checker.getExportsOfModule(module)) {
                if (skipAlias(exported, checker) === exportedSymbol) {
                    result.push(module);
                }
            }
        });
        return result;
    }

    export function getCompletionEntrySymbol(
        typeChecker: TypeChecker,
        log: (message: string) => void,
        compilerOptions: CompilerOptions,
        sourceFile: SourceFile,
        position: number,
        entryId: CompletionEntryIdentifier,
        allSourceFiles: ReadonlyArray<SourceFile>,
    ): Symbol | undefined {
        const completion = getSymbolCompletionFromEntryId(typeChecker, log, compilerOptions, sourceFile, position, entryId, allSourceFiles);
        return completion.type === "symbol" ? completion.symbol : undefined;
    }

    const enum CompletionDataKind { Data, JsDocTagName, JsDocTag, JsDocParameterName }
    /** true: after the `=` sign but no identifier has been typed yet. Else is the Identifier after the initializer. */
    type IsJsxInitializer = boolean | Identifier;
    interface CompletionData {
        readonly kind: CompletionDataKind.Data;
        readonly symbols: ReadonlyArray<Symbol>;
        readonly completionKind: CompletionKind;
        /** Note that the presence of this alone doesn't mean that we need a conversion. Only do that if the completion is not an ordinary identifier. */
        readonly propertyAccessToConvert: PropertyAccessExpression | undefined;
        readonly isNewIdentifierLocation: boolean;
        readonly location: Node | undefined;
        readonly keywordFilters: KeywordCompletionFilters;
        readonly symbolToOriginInfoMap: SymbolOriginInfoMap;
        readonly recommendedCompletion: Symbol | undefined;
        readonly previousToken: Node | undefined;
        readonly isJsxInitializer: IsJsxInitializer;
    }
    type Request = { readonly kind: CompletionDataKind.JsDocTagName | CompletionDataKind.JsDocTag } | { readonly kind: CompletionDataKind.JsDocParameterName, tag: JSDocParameterTag };

    const enum CompletionKind {
        ObjectPropertyDeclaration,
        /** Note that sometimes we access completions from global scope, but use "None" instead of this. See isGlobalCompletionScope. */
        Global,
        PropertyAccess,
        MemberLike,
        String,
        None,
    }

    function getRecommendedCompletion(currentToken: Node, checker: TypeChecker): Symbol | undefined {
        const ty = getContextualType(currentToken, checker);
        const symbol = ty && ty.symbol;
        // Don't include make a recommended completion for an abstract class
        return symbol && (symbol.flags & SymbolFlags.Enum || symbol.flags & SymbolFlags.Class && !isAbstractConstructorSymbol(symbol))
            ? getFirstSymbolInChain(symbol, currentToken, checker)
            : undefined;
    }

    function getContextualType(currentToken: Node, checker: ts.TypeChecker): Type | undefined {
        const { parent } = currentToken;
        switch (currentToken.kind) {
            case ts.SyntaxKind.Identifier:
                return getContextualTypeFromParent(currentToken as ts.Identifier, checker);
            case ts.SyntaxKind.EqualsToken:
                return ts.isVariableDeclaration(parent) ? checker.getContextualType(parent.initializer) :
                    ts.isBinaryExpression(parent) ? checker.getTypeAtLocation(parent.left) : undefined;
            case ts.SyntaxKind.NewKeyword:
                return checker.getContextualType(parent as ts.Expression);
            case ts.SyntaxKind.CaseKeyword:
                return getSwitchedType(cast(currentToken.parent, isCaseClause), checker);
            default:
                return isEqualityOperatorKind(currentToken.kind) && ts.isBinaryExpression(parent) && isEqualityOperatorKind(parent.operatorToken.kind)
                    // completion at `x ===/**/` should be for the right side
                    ? checker.getTypeAtLocation(parent.left)
                    : checker.getContextualType(currentToken as ts.Expression);
        }
    }

    function getContextualTypeFromParent(node: ts.Expression, checker: ts.TypeChecker): Type | undefined {
        const { parent } = node;
        switch (parent.kind) {
            case ts.SyntaxKind.NewExpression:
                return checker.getContextualType(parent as ts.NewExpression);
            case ts.SyntaxKind.BinaryExpression: {
                const { left, operatorToken, right } = parent as ts.BinaryExpression;
                return isEqualityOperatorKind(operatorToken.kind)
                    ? checker.getTypeAtLocation(node === right ? left : right)
                    : checker.getContextualType(node);
            }
            case ts.SyntaxKind.CaseClause:
                return (parent as ts.CaseClause).expression === node ? getSwitchedType(parent as ts.CaseClause, checker) : undefined;
            default:
                return checker.getContextualType(node);
        }
    }

    function getSwitchedType(caseClause: ts.CaseClause, checker: ts.TypeChecker): ts.Type {
        return checker.getTypeAtLocation(caseClause.parent.parent.expression);
    }

    function getFirstSymbolInChain(symbol: Symbol, enclosingDeclaration: Node, checker: TypeChecker): Symbol | undefined {
        const chain = checker.getAccessibleSymbolChain(symbol, enclosingDeclaration, /*meaning*/ SymbolFlags.All, /*useOnlyExternalAliasing*/ false);
        if (chain) return first(chain);
        return isModuleSymbol(symbol.parent) ? symbol : symbol.parent && getFirstSymbolInChain(symbol.parent, enclosingDeclaration, checker);
    }

    function isModuleSymbol(symbol: Symbol): boolean {
        return symbol.declarations.some(d => d.kind === SyntaxKind.SourceFile);
    }

    function getCompletionData(
        typeChecker: TypeChecker,
        log: (message: string) => void,
        sourceFile: SourceFile,
        position: number,
        allSourceFiles: ReadonlyArray<SourceFile>,
        options: GetCompletionsAtPositionOptions,
        target: ScriptTarget,
    ): CompletionData | Request | undefined {
        let start = timestamp();
        let currentToken = getTokenAtPosition(sourceFile, position, /*includeJsDocComment*/ false); // TODO: GH#15853
        // We will check for jsdoc comments with insideComment and getJsDocTagAtPosition. (TODO: that seems rather inefficient to check the same thing so many times.)

        log("getCompletionData: Get current token: " + (timestamp() - start));

        start = timestamp();
        // Completion not allowed inside comments, bail out if this is the case
        const insideComment = isInComment(sourceFile, position, currentToken);
        log("getCompletionData: Is inside comment: " + (timestamp() - start));

        let insideJsDocTagTypeExpression = false;
        if (insideComment) {
            if (hasDocComment(sourceFile, position)) {
                if (sourceFile.text.charCodeAt(position - 1) === CharacterCodes.at) {
                    // The current position is next to the '@' sign, when no tag name being provided yet.
                    // Provide a full list of tag names
                    return { kind: CompletionDataKind.JsDocTagName };
                }
                else {
                    // When completion is requested without "@", we will have check to make sure that
                    // there are no comments prefix the request position. We will only allow "*" and space.
                    // e.g
                    //   /** |c| /*
                    //
                    //   /**
                    //     |c|
                    //    */
                    //
                    //   /**
                    //    * |c|
                    //    */
                    //
                    //   /**
                    //    *         |c|
                    //    */
                    const lineStart = getLineStartPositionForPosition(position, sourceFile);
                    if (!(sourceFile.text.substring(lineStart, position).match(/[^\*|\s|(/\*\*)]/))) {
                        return { kind: CompletionDataKind.JsDocTag };
                    }
                }
            }

            // Completion should work inside certain JsDoc tags. For example:
            //     /** @type {number | string} */
            // Completion should work in the brackets
            const tag = getJsDocTagAtPosition(currentToken, position);
            if (tag) {
                if (tag.tagName.pos <= position && position <= tag.tagName.end) {
                    return { kind: CompletionDataKind.JsDocTagName };
                }
                if (isTagWithTypeExpression(tag) && tag.typeExpression && tag.typeExpression.kind === SyntaxKind.JSDocTypeExpression) {
                    currentToken = getTokenAtPosition(sourceFile, position, /*includeJsDocComment*/ true);
                    if (!currentToken ||
                        (!isDeclarationName(currentToken) &&
                            (currentToken.parent.kind !== SyntaxKind.JSDocPropertyTag ||
                                (<JSDocPropertyTag>currentToken.parent).name !== currentToken))) {
                        // Use as type location if inside tag's type expression
                        insideJsDocTagTypeExpression = isCurrentlyEditingNode(tag.typeExpression);
                    }
                }
                if (isJSDocParameterTag(tag) && (nodeIsMissing(tag.name) || tag.name.pos <= position && position <= tag.name.end)) {
                    return { kind: CompletionDataKind.JsDocParameterName, tag };
                }
            }

            if (!insideJsDocTagTypeExpression) {
                // Proceed if the current position is in jsDoc tag expression; otherwise it is a normal
                // comment or the plain text part of a jsDoc comment, so no completion should be available
                log("Returning an empty list because completion was inside a regular comment or plain text part of a JsDoc comment.");
                return undefined;
            }
        }

        start = timestamp();
        const previousToken = findPrecedingToken(position, sourceFile, /*startNode*/ undefined, insideJsDocTagTypeExpression);
        log("getCompletionData: Get previous token 1: " + (timestamp() - start));

        // The decision to provide completion depends on the contextToken, which is determined through the previousToken.
        // Note: 'previousToken' (and thus 'contextToken') can be undefined if we are the beginning of the file
        let contextToken = previousToken;

        // Check if the caret is at the end of an identifier; this is a partial identifier that we want to complete: e.g. a.toS|
        // Skip this partial identifier and adjust the contextToken to the token that precedes it.
        if (contextToken && position <= contextToken.end && isWord(contextToken.kind)) {
            const start = timestamp();
            contextToken = findPrecedingToken(contextToken.getFullStart(), sourceFile, /*startNode*/ undefined, insideJsDocTagTypeExpression);
            log("getCompletionData: Get previous token 2: " + (timestamp() - start));
        }

        // Find the node where completion is requested on.
        // Also determine whether we are trying to complete with members of that node
        // or attributes of a JSX tag.
        let node = currentToken;
        let propertyAccessToConvert: PropertyAccessExpression | undefined;
        let isRightOfDot = false;
        let isRightOfOpenTag = false;
        let isStartingCloseTag = false;
        let isJsxInitializer: IsJsxInitializer = false;

        let location = getTouchingPropertyName(sourceFile, position, insideJsDocTagTypeExpression); // TODO: GH#15853
        if (contextToken) {
            // Bail out if this is a known invalid completion location
            if (isCompletionListBlocker(contextToken)) {
                log("Returning an empty list because completion was requested in an invalid position.");
                return undefined;
            }

            let parent = contextToken.parent;
            if (contextToken.kind === SyntaxKind.DotToken) {
                isRightOfDot = true;
                switch (parent.kind) {
                    case SyntaxKind.PropertyAccessExpression:
                        propertyAccessToConvert = parent as PropertyAccessExpression;
                        node = propertyAccessToConvert.expression;
                        break;
                    case SyntaxKind.QualifiedName:
                        node = (parent as QualifiedName).left;
                        break;
                    default:
                        // There is nothing that precedes the dot, so this likely just a stray character
                        // or leading into a '...' token. Just bail out instead.
                        return undefined;
                }
            }
            else if (sourceFile.languageVariant === LanguageVariant.JSX) {
                // <UI.Test /* completion position */ />
                // If the tagname is a property access expression, we will then walk up to the top most of property access expression.
                // Then, try to get a JSX container and its associated attributes type.
                if (parent && parent.kind === SyntaxKind.PropertyAccessExpression) {
                    contextToken = parent;
                    parent = parent.parent;
                }

                switch (parent.kind) {
                    case SyntaxKind.JsxClosingElement:
                        if (contextToken.kind === SyntaxKind.SlashToken) {
                            isStartingCloseTag = true;
                            location = contextToken;
                        }
                        break;

                    case SyntaxKind.BinaryExpression:
                        if (!((parent as BinaryExpression).left.flags & NodeFlags.ThisNodeHasError)) {
                            // It has a left-hand side, so we're not in an opening JSX tag.
                            break;
                        }
                    // falls through

                    case SyntaxKind.JsxSelfClosingElement:
                    case SyntaxKind.JsxElement:
                    case SyntaxKind.JsxOpeningElement:
                        if (contextToken.kind === SyntaxKind.LessThanToken) {
                            isRightOfOpenTag = true;
                            location = contextToken;
                        }
                        break;

                    case SyntaxKind.JsxAttribute:
                        switch (previousToken.kind) {
                            case SyntaxKind.EqualsToken:
                                isJsxInitializer = true;
                                break;
                            case SyntaxKind.Identifier:
                                if (previousToken !== (parent as JsxAttribute).name) {
                                    isJsxInitializer = previousToken as Identifier;
                                }
                        }
                        break;
                }
            }
        }

        const semanticStart = timestamp();
        let completionKind = CompletionKind.None;
        let isNewIdentifierLocation = false;
        let keywordFilters = KeywordCompletionFilters.None;
        let symbols: Symbol[] = [];
        const symbolToOriginInfoMap: SymbolOriginInfoMap = [];

        if (isRightOfDot) {
            getTypeScriptMemberSymbols();
        }
        else if (isRightOfOpenTag) {
            const tagSymbols = typeChecker.getJsxIntrinsicTagNames();
            if (tryGetGlobalSymbols()) {
                symbols = tagSymbols.concat(symbols.filter(s => !!(s.flags & (SymbolFlags.Value | SymbolFlags.Alias))));
            }
            else {
                symbols = tagSymbols;
            }
            completionKind = CompletionKind.MemberLike;
        }
        else if (isStartingCloseTag) {
            const tagName = (<JsxElement>contextToken.parent.parent).openingElement.tagName;
            const tagSymbol = typeChecker.getSymbolAtLocation(tagName);

            if (!typeChecker.isUnknownSymbol(tagSymbol)) {
                symbols = [tagSymbol];
            }
            completionKind = CompletionKind.MemberLike;
        }
        else {
            // For JavaScript or TypeScript, if we're not after a dot, then just try to get the
            // global symbols in scope.  These results should be valid for either language as
            // the set of symbols that can be referenced from this location.
            if (!tryGetGlobalSymbols()) {
                return undefined;
            }
        }

        log("getCompletionData: Semantic work: " + (timestamp() - semanticStart));

        const recommendedCompletion = previousToken && getRecommendedCompletion(previousToken, typeChecker);
        return { kind: CompletionDataKind.Data, symbols, completionKind, propertyAccessToConvert, isNewIdentifierLocation, location, keywordFilters, symbolToOriginInfoMap, recommendedCompletion, previousToken, isJsxInitializer };

        type JSDocTagWithTypeExpression = JSDocParameterTag | JSDocPropertyTag | JSDocReturnTag | JSDocTypeTag | JSDocTypedefTag;

        function isTagWithTypeExpression(tag: JSDocTag): tag is JSDocTagWithTypeExpression {
            switch (tag.kind) {
                case SyntaxKind.JSDocParameterTag:
                case SyntaxKind.JSDocPropertyTag:
                case SyntaxKind.JSDocReturnTag:
                case SyntaxKind.JSDocTypeTag:
                case SyntaxKind.JSDocTypedefTag:
                    return true;
            }
        }

        function getTypeScriptMemberSymbols(): void {
            // Right of dot member completion list
            completionKind = CompletionKind.PropertyAccess;

            // Since this is qualified name check its a type node location
            const isTypeLocation = insideJsDocTagTypeExpression || isPartOfTypeNode(node.parent);
            const isRhsOfImportDeclaration = isInRightSideOfInternalImportEqualsDeclaration(node);
            if (isEntityName(node)) {
                let symbol = typeChecker.getSymbolAtLocation(node);
                if (symbol) {
                    symbol = skipAlias(symbol, typeChecker);

                    if (symbol.flags & (SymbolFlags.Module | SymbolFlags.Enum)) {
                        // Extract module or enum members
                        const exportedSymbols = typeChecker.getExportsOfModule(symbol);
                        const isValidValueAccess = (symbol: Symbol) => typeChecker.isValidPropertyAccess(<PropertyAccessExpression>(node.parent), symbol.name);
                        const isValidTypeAccess = (symbol: Symbol) => symbolCanBeReferencedAtTypeLocation(symbol);
                        const isValidAccess = isRhsOfImportDeclaration ?
                            // Any kind is allowed when dotting off namespace in internal import equals declaration
                            (symbol: Symbol) => isValidTypeAccess(symbol) || isValidValueAccess(symbol) :
                            isTypeLocation ? isValidTypeAccess : isValidValueAccess;
                        for (const symbol of exportedSymbols) {
                            if (isValidAccess(symbol)) {
                                symbols.push(symbol);
                            }
                        }

                        // If the module is merged with a value, we must get the type of the class and add its propertes (for inherited static methods).
                        if (!isTypeLocation && symbol.declarations.some(d => d.kind !== SyntaxKind.SourceFile && d.kind !== SyntaxKind.ModuleDeclaration && d.kind !== SyntaxKind.EnumDeclaration)) {
                            addTypeProperties(typeChecker.getTypeOfSymbolAtLocation(symbol, node));
                        }

                        return;
                    }
                }
            }

            if (!isTypeLocation) {
                addTypeProperties(typeChecker.getTypeAtLocation(node));
            }
        }

        function addTypeProperties(type: Type): void {
            if (isSourceFileJavaScript(sourceFile)) {
                // In javascript files, for union types, we don't just get the members that
                // the individual types have in common, we also include all the members that
                // each individual type has. This is because we're going to add all identifiers
                // anyways. So we might as well elevate the members that were at least part
                // of the individual types to a higher status since we know what they are.
                symbols.push(...getPropertiesForCompletion(type, typeChecker, /*isForAccess*/ true));
            }
            else {
                for (const symbol of type.getApparentProperties()) {
                    if (typeChecker.isValidPropertyAccessForCompletions(<PropertyAccessExpression>(node.parent), type, symbol)) {
                        symbols.push(symbol);
                    }
                }
            }
        }

        function tryGetGlobalSymbols(): boolean {
            let objectLikeContainer: ObjectLiteralExpression | BindingPattern;
            let namedImportsOrExports: NamedImportsOrExports;
            let classLikeContainer: ClassLikeDeclaration;
            let jsxContainer: JsxOpeningLikeElement;

            if (objectLikeContainer = tryGetObjectLikeCompletionContainer(contextToken)) {
                return tryGetObjectLikeCompletionSymbols(objectLikeContainer);
            }

            if (namedImportsOrExports = tryGetNamedImportsOrExportsForCompletion(contextToken)) {
                // cursor is in an import clause
                // try to show exported member for imported module
                return tryGetImportOrExportClauseCompletionSymbols(namedImportsOrExports);
            }

            if (tryGetConstructorLikeCompletionContainer(contextToken)) {
                // no members, only keywords
                completionKind = CompletionKind.None;
                // Declaring new property/method/accessor
                isNewIdentifierLocation = true;
                // Has keywords for constructor parameter
                keywordFilters = KeywordCompletionFilters.ConstructorParameterKeywords;
                return true;
            }

            if (tryGetFunctionLikeBodyCompletionContainer(contextToken)) {
                keywordFilters = KeywordCompletionFilters.FunctionLikeBodyKeywords;
            }

            if (classLikeContainer = tryGetClassLikeCompletionContainer(contextToken)) {
                // cursor inside class declaration
                getGetClassLikeCompletionSymbols(classLikeContainer);
                return true;
            }

            if (jsxContainer = tryGetContainingJsxElement(contextToken)) {
                let attrsType: Type;
                if ((jsxContainer.kind === SyntaxKind.JsxSelfClosingElement) || (jsxContainer.kind === SyntaxKind.JsxOpeningElement)) {
                    // Cursor is inside a JSX self-closing element or opening element
                    attrsType = typeChecker.getAllAttributesTypeFromJsxOpeningLikeElement(<JsxOpeningLikeElement>jsxContainer);

                    if (attrsType) {
                        symbols = filterJsxAttributes(typeChecker.getPropertiesOfType(attrsType), (<JsxOpeningLikeElement>jsxContainer).attributes.properties);
                        completionKind = CompletionKind.MemberLike;
                        isNewIdentifierLocation = false;
                        return true;
                    }
                }
            }

            // Get all entities in the current scope.
            completionKind = CompletionKind.None;
            isNewIdentifierLocation = isNewIdentifierDefinitionLocation(contextToken);

            if (previousToken !== contextToken) {
                Debug.assert(!!previousToken, "Expected 'contextToken' to be defined when different from 'previousToken'.");
            }
            // We need to find the node that will give us an appropriate scope to begin
            // aggregating completion candidates. This is achieved in 'getScopeNode'
            // by finding the first node that encompasses a position, accounting for whether a node
            // is "complete" to decide whether a position belongs to the node.
            //
            // However, at the end of an identifier, we are interested in the scope of the identifier
            // itself, but fall outside of the identifier. For instance:
            //
            //      xyz => x$
            //
            // the cursor is outside of both the 'x' and the arrow function 'xyz => x',
            // so 'xyz' is not returned in our results.
            //
            // We define 'adjustedPosition' so that we may appropriately account for
            // being at the end of an identifier. The intention is that if requesting completion
            // at the end of an identifier, it should be effectively equivalent to requesting completion
            // anywhere inside/at the beginning of the identifier. So in the previous case, the
            // 'adjustedPosition' will work as if requesting completion in the following:
            //
            //      xyz => $x
            //
            // If previousToken !== contextToken, then
            //   - 'contextToken' was adjusted to the token prior to 'previousToken'
            //      because we were at the end of an identifier.
            //   - 'previousToken' is defined.
            const adjustedPosition = previousToken !== contextToken ?
                previousToken.getStart() :
                position;

            const scopeNode = getScopeNode(contextToken, adjustedPosition, sourceFile) || sourceFile;
            if (isGlobalCompletionScope(scopeNode)) {
                completionKind = CompletionKind.Global;
            }

            const symbolMeanings = SymbolFlags.Type | SymbolFlags.Value | SymbolFlags.Namespace | SymbolFlags.Alias;

            symbols = typeChecker.getSymbolsInScope(scopeNode, symbolMeanings);

            // Need to insert 'this.' before properties of `this` type, so only do that if `includeInsertTextCompletions`
            if (options.includeInsertTextCompletions && scopeNode.kind !== SyntaxKind.SourceFile) {
                const thisType = typeChecker.tryGetThisTypeAt(scopeNode);
                if (thisType) {
                    for (const symbol of getPropertiesForCompletion(thisType, typeChecker, /*isForAccess*/ true)) {
                        symbolToOriginInfoMap[getSymbolId(symbol)] = { type: "this-type" };
                        symbols.push(symbol);
                    }
                }
            }

            if (options.includeExternalModuleExports) {
                getSymbolsFromOtherSourceFileExports(symbols, previousToken && isIdentifier(previousToken) ? previousToken.text : "", target);
            }
            filterGlobalCompletion(symbols);

            return true;
        }

        function isGlobalCompletionScope(scopeNode: Node): boolean {
            switch (scopeNode.kind) {
                case SyntaxKind.SourceFile:
                case SyntaxKind.TemplateExpression:
                case SyntaxKind.JsxExpression:
                case SyntaxKind.Block:
                    return true;
                default:
                    return isStatement(scopeNode);
            }
        }

        function filterGlobalCompletion(symbols: Symbol[]): void {
            const isTypeCompletion = insideJsDocTagTypeExpression || !isContextTokenValueLocation(contextToken) && (isPartOfTypeNode(location) || isContextTokenTypeLocation(contextToken));
            if (isTypeCompletion) keywordFilters = KeywordCompletionFilters.TypeKeywords;

            filterMutate(symbols, symbol => {
                if (!isSourceFile(location)) {
                    // export = /**/ here we want to get all meanings, so any symbol is ok
                    if (isExportAssignment(location.parent)) {
                        return true;
                    }

                    symbol = skipAlias(symbol, typeChecker);

                    // import m = /**/ <-- It can only access namespace (if typing import = x. this would get member symbols and not namespace)
                    if (isInRightSideOfInternalImportEqualsDeclaration(location)) {
                        return !!(symbol.flags & SymbolFlags.Namespace);
                    }

                    if (isTypeCompletion) {
                        // Its a type, but you can reach it by namespace.type as well
                        return symbolCanBeReferencedAtTypeLocation(symbol);
                    }
                }

                // expressions are value space (which includes the value namespaces)
                return !!(getCombinedLocalAndExportSymbolFlags(symbol) & SymbolFlags.Value);
            });
        }

        function isContextTokenValueLocation(contextToken: Node) {
            return contextToken &&
                contextToken.kind === SyntaxKind.TypeOfKeyword &&
                contextToken.parent.kind === SyntaxKind.TypeQuery;
        }

        function isContextTokenTypeLocation(contextToken: Node): boolean {
            if (contextToken) {
                const parentKind = contextToken.parent.kind;
                switch (contextToken.kind) {
                    case SyntaxKind.ColonToken:
                        return parentKind === SyntaxKind.PropertyDeclaration ||
                            parentKind === SyntaxKind.PropertySignature ||
                            parentKind === SyntaxKind.Parameter ||
                            parentKind === SyntaxKind.VariableDeclaration ||
                            isFunctionLikeKind(parentKind);

                    case SyntaxKind.EqualsToken:
                        return parentKind === SyntaxKind.TypeAliasDeclaration;

                    case SyntaxKind.AsKeyword:
                        return parentKind === SyntaxKind.AsExpression;
                }
            }
            return false;
        }

        function symbolCanBeReferencedAtTypeLocation(symbol: Symbol): boolean {
            symbol = symbol.exportSymbol || symbol;

            // This is an alias, follow what it aliases
            symbol = skipAlias(symbol, typeChecker);

            if (symbol.flags & SymbolFlags.Type) {
                return true;
            }

            if (symbol.flags & SymbolFlags.Module) {
                const exportedSymbols = typeChecker.getExportsOfModule(symbol);
                // If the exported symbols contains type,
                // symbol can be referenced at locations where type is allowed
                return forEach(exportedSymbols, symbolCanBeReferencedAtTypeLocation);
            }
        }

        function getSymbolsFromOtherSourceFileExports(symbols: Symbol[], tokenText: string, target: ScriptTarget): void {
            const tokenTextLowerCase = tokenText.toLowerCase();

            codefix.forEachExternalModuleToImportFrom(typeChecker, sourceFile, allSourceFiles, moduleSymbol => {
                for (let symbol of typeChecker.getExportsOfModule(moduleSymbol)) {
                    // Don't add a completion for a re-export, only for the original.
                    // If `symbol.parent !== ...`, this comes from an `export * from "foo"` re-export. Those don't create new symbols.
                    // If `some(...)`, this comes from an `export { foo } from "foo"` re-export, which creates a new symbol (thus isn't caught by the first check).
                    if (typeChecker.getMergedSymbol(symbol.parent) !== typeChecker.resolveExternalModuleSymbol(moduleSymbol)
                        || some(symbol.declarations, d => isExportSpecifier(d) && !!d.parent.parent.moduleSpecifier)) {
                        continue;
                    }

                    const isDefaultExport = symbol.name === InternalSymbolName.Default;
                    if (isDefaultExport) {
                        symbol = getLocalSymbolForExportDefault(symbol) || symbol;
                    }

                    const origin: SymbolOriginInfo = { type: "export", moduleSymbol, isDefaultExport };
                    if (stringContainsCharactersInOrder(getSymbolName(symbol, origin, target).toLowerCase(), tokenTextLowerCase)) {
                        symbols.push(symbol);
                        symbolToOriginInfoMap[getSymbolId(symbol)] = origin;
                    }
                }
            });
        }

        /**
         * True if you could remove some characters in `a` to get `b`.
         * E.g., true for "abcdef" and "bdf".
         * But not true for "abcdef" and "dbf".
         */
        function stringContainsCharactersInOrder(str: string, characters: string): boolean {
            if (characters.length === 0) {
                return true;
            }

            let characterIndex = 0;
            for (let strIndex = 0; strIndex < str.length; strIndex++) {
                if (str.charCodeAt(strIndex) === characters.charCodeAt(characterIndex)) {
                    characterIndex++;
                    if (characterIndex === characters.length) {
                        return true;
                    }
                }
            }

            // Did not find all characters
            return false;
        }

        /**
         * Finds the first node that "embraces" the position, so that one may
         * accurately aggregate locals from the closest containing scope.
         */
        function getScopeNode(initialToken: Node, position: number, sourceFile: SourceFile) {
            let scope = initialToken;
            while (scope && !positionBelongsToNode(scope, position, sourceFile)) {
                scope = scope.parent;
            }
            return scope;
        }

        function isCompletionListBlocker(contextToken: Node): boolean {
            const start = timestamp();
            const result = isInStringOrRegularExpressionOrTemplateLiteral(contextToken) ||
                isSolelyIdentifierDefinitionLocation(contextToken) ||
                isDotOfNumericLiteral(contextToken) ||
                isInJsxText(contextToken);
            log("getCompletionsAtPosition: isCompletionListBlocker: " + (timestamp() - start));
            return result;
        }

        function isInJsxText(contextToken: Node): boolean {
            if (contextToken.kind === SyntaxKind.JsxText) {
                return true;
            }

            if (contextToken.kind === SyntaxKind.GreaterThanToken && contextToken.parent) {
                if (contextToken.parent.kind === SyntaxKind.JsxOpeningElement) {
                    return true;
                }

                if (contextToken.parent.kind === SyntaxKind.JsxClosingElement || contextToken.parent.kind === SyntaxKind.JsxSelfClosingElement) {
                    return contextToken.parent.parent && contextToken.parent.parent.kind === SyntaxKind.JsxElement;
                }
            }
            return false;
        }

        function isNewIdentifierDefinitionLocation(previousToken: Node): boolean {
            if (previousToken) {
                const containingNodeKind = previousToken.parent.kind;
                switch (previousToken.kind) {
                    case SyntaxKind.CommaToken:
                        return containingNodeKind === SyntaxKind.CallExpression               // func( a, |
                            || containingNodeKind === SyntaxKind.Constructor                  // constructor( a, |   /* public, protected, private keywords are allowed here, so show completion */
                            || containingNodeKind === SyntaxKind.NewExpression                // new C(a, |
                            || containingNodeKind === SyntaxKind.ArrayLiteralExpression       // [a, |
                            || containingNodeKind === SyntaxKind.BinaryExpression             // const x = (a, |
                            || containingNodeKind === SyntaxKind.FunctionType;                // var x: (s: string, list|

                    case SyntaxKind.OpenParenToken:
                        return containingNodeKind === SyntaxKind.CallExpression               // func( |
                            || containingNodeKind === SyntaxKind.Constructor                  // constructor( |
                            || containingNodeKind === SyntaxKind.NewExpression                // new C(a|
                            || containingNodeKind === SyntaxKind.ParenthesizedExpression      // const x = (a|
                            || containingNodeKind === SyntaxKind.ParenthesizedType;           // function F(pred: (a| /* this can become an arrow function, where 'a' is the argument */

                    case SyntaxKind.OpenBracketToken:
                        return containingNodeKind === SyntaxKind.ArrayLiteralExpression       // [ |
                            || containingNodeKind === SyntaxKind.IndexSignature               // [ | : string ]
                            || containingNodeKind === SyntaxKind.ComputedPropertyName;         // [ |    /* this can become an index signature */

                    case SyntaxKind.ModuleKeyword:                                            // module |
                    case SyntaxKind.NamespaceKeyword:                                         // namespace |
                        return true;

                    case SyntaxKind.DotToken:
                        return containingNodeKind === SyntaxKind.ModuleDeclaration;           // module A.|

                    case SyntaxKind.OpenBraceToken:
                        return containingNodeKind === SyntaxKind.ClassDeclaration;            // class A{ |

                    case SyntaxKind.EqualsToken:
                        return containingNodeKind === SyntaxKind.VariableDeclaration          // const x = a|
                            || containingNodeKind === SyntaxKind.BinaryExpression;            // x = a|

                    case SyntaxKind.TemplateHead:
                        return containingNodeKind === SyntaxKind.TemplateExpression;          // `aa ${|

                    case SyntaxKind.TemplateMiddle:
                        return containingNodeKind === SyntaxKind.TemplateSpan;                // `aa ${10} dd ${|

                    case SyntaxKind.PublicKeyword:
                    case SyntaxKind.PrivateKeyword:
                    case SyntaxKind.ProtectedKeyword:
                        return containingNodeKind === SyntaxKind.PropertyDeclaration;         // class A{ public |
                }

                // Previous token may have been a keyword that was converted to an identifier.
                switch (previousToken.getText()) {
                    case "public":
                    case "protected":
                    case "private":
                        return true;
                }
            }

            return false;
        }

        function isInStringOrRegularExpressionOrTemplateLiteral(contextToken: Node): boolean {
            if (contextToken.kind === SyntaxKind.StringLiteral
                || contextToken.kind === SyntaxKind.RegularExpressionLiteral
                || isTemplateLiteralKind(contextToken.kind)) {
                const start = contextToken.getStart();
                const end = contextToken.getEnd();

                // To be "in" one of these literals, the position has to be:
                //   1. entirely within the token text.
                //   2. at the end position of an unterminated token.
                //   3. at the end of a regular expression (due to trailing flags like '/foo/g').
                if (start < position && position < end) {
                    return true;
                }

                if (position === end) {
                    return !!(<LiteralExpression>contextToken).isUnterminated
                        || contextToken.kind === SyntaxKind.RegularExpressionLiteral;
                }
            }

            return false;
        }

        /**
         * Aggregates relevant symbols for completion in object literals and object binding patterns.
         * Relevant symbols are stored in the captured 'symbols' variable.
         *
         * @returns true if 'symbols' was successfully populated; false otherwise.
         */
        function tryGetObjectLikeCompletionSymbols(objectLikeContainer: ObjectLiteralExpression | ObjectBindingPattern): boolean {
            // We're looking up possible property names from contextual/inferred/declared type.
            completionKind = CompletionKind.ObjectPropertyDeclaration;

            let typeMembers: Symbol[];
            let existingMembers: ReadonlyArray<Declaration>;

            if (objectLikeContainer.kind === SyntaxKind.ObjectLiteralExpression) {
                // We are completing on contextual types, but may also include properties
                // other than those within the declared type.
                isNewIdentifierLocation = true;
                const typeForObject = typeChecker.getContextualType(<ObjectLiteralExpression>objectLikeContainer);
                if (!typeForObject) return false;
                typeMembers = getPropertiesForCompletion(typeForObject, typeChecker, /*isForAccess*/ false);
                existingMembers = (<ObjectLiteralExpression>objectLikeContainer).properties;
            }
            else {
                Debug.assert(objectLikeContainer.kind === SyntaxKind.ObjectBindingPattern);
                // We are *only* completing on properties from the type being destructured.
                isNewIdentifierLocation = false;

                const rootDeclaration = getRootDeclaration(objectLikeContainer.parent);
                if (!isVariableLike(rootDeclaration)) throw Debug.fail("Root declaration is not variable-like.");

                // We don't want to complete using the type acquired by the shape
                // of the binding pattern; we are only interested in types acquired
                // through type declaration or inference.
                // Also proceed if rootDeclaration is a parameter and if its containing function expression/arrow function is contextually typed -
                // type of parameter will flow in from the contextual type of the function
                let canGetType = hasInitializer(rootDeclaration) || hasType(rootDeclaration) || rootDeclaration.parent.parent.kind === SyntaxKind.ForOfStatement;
                if (!canGetType && rootDeclaration.kind === SyntaxKind.Parameter) {
                    if (isExpression(rootDeclaration.parent)) {
                        canGetType = !!typeChecker.getContextualType(<Expression>rootDeclaration.parent);
                    }
                    else if (rootDeclaration.parent.kind === SyntaxKind.MethodDeclaration || rootDeclaration.parent.kind === SyntaxKind.SetAccessor) {
                        canGetType = isExpression(rootDeclaration.parent.parent) && !!typeChecker.getContextualType(<Expression>rootDeclaration.parent.parent);
                    }
                }
                if (canGetType) {
                    const typeForObject = typeChecker.getTypeAtLocation(objectLikeContainer);
                    if (!typeForObject) return false;
                    // In a binding pattern, get only known properties. Everywhere else we will get all possible properties.
                    typeMembers = typeChecker.getPropertiesOfType(typeForObject).filter((symbol) => !(getDeclarationModifierFlagsFromSymbol(symbol) & ModifierFlags.NonPublicAccessibilityModifier));
                    existingMembers = (<ObjectBindingPattern>objectLikeContainer).elements;
                }
            }

            if (typeMembers && typeMembers.length > 0) {
                // Add filtered items to the completion list
                symbols = filterObjectMembersList(typeMembers, existingMembers);
            }
            return true;
        }

        /**
         * Aggregates relevant symbols for completion in import clauses and export clauses
         * whose declarations have a module specifier; for instance, symbols will be aggregated for
         *
         *      import { | } from "moduleName";
         *      export { a as foo, | } from "moduleName";
         *
         * but not for
         *
         *      export { | };
         *
         * Relevant symbols are stored in the captured 'symbols' variable.
         *
         * @returns true if 'symbols' was successfully populated; false otherwise.
         */
        function tryGetImportOrExportClauseCompletionSymbols(namedImportsOrExports: NamedImportsOrExports): boolean {
            const declarationKind = namedImportsOrExports.kind === SyntaxKind.NamedImports ?
                SyntaxKind.ImportDeclaration :
                SyntaxKind.ExportDeclaration;
            const importOrExportDeclaration = <ImportDeclaration | ExportDeclaration>getAncestor(namedImportsOrExports, declarationKind);
            const moduleSpecifier = importOrExportDeclaration.moduleSpecifier;

            if (!moduleSpecifier) {
                return false;
            }

            completionKind = CompletionKind.MemberLike;
            isNewIdentifierLocation = false;

            const moduleSpecifierSymbol = typeChecker.getSymbolAtLocation(moduleSpecifier);
            if (!moduleSpecifierSymbol) {
                symbols = emptyArray;
                return true;
            }

            const exports = typeChecker.getExportsAndPropertiesOfModule(moduleSpecifierSymbol);
            symbols = filterNamedImportOrExportCompletionItems(exports, namedImportsOrExports.elements);
            return true;
        }

        /**
         * Aggregates relevant symbols for completion in class declaration
         * Relevant symbols are stored in the captured 'symbols' variable.
         */
        function getGetClassLikeCompletionSymbols(classLikeDeclaration: ClassLikeDeclaration) {
            // We're looking up possible property names from parent type.
            completionKind = CompletionKind.MemberLike;
            // Declaring new property/method/accessor
            isNewIdentifierLocation = true;
            // Has keywords for class elements
            keywordFilters = KeywordCompletionFilters.ClassElementKeywords;

            const baseTypeNode = getClassExtendsHeritageClauseElement(classLikeDeclaration);
            const implementsTypeNodes = getClassImplementsHeritageClauseElements(classLikeDeclaration);
            if (baseTypeNode || implementsTypeNodes) {
                const classElement = contextToken.parent;
                let classElementModifierFlags = isClassElement(classElement) && getModifierFlags(classElement);
                // If this is context token is not something we are editing now, consider if this would lead to be modifier
                if (contextToken.kind === SyntaxKind.Identifier && !isCurrentlyEditingNode(contextToken)) {
                    switch (contextToken.getText()) {
                        case "private":
                            classElementModifierFlags = classElementModifierFlags | ModifierFlags.Private;
                            break;
                        case "static":
                            classElementModifierFlags = classElementModifierFlags | ModifierFlags.Static;
                            break;
                    }
                }

                // No member list for private methods
                if (!(classElementModifierFlags & ModifierFlags.Private)) {
                    let baseClassTypeToGetPropertiesFrom: Type;
                    if (baseTypeNode) {
                        baseClassTypeToGetPropertiesFrom = typeChecker.getTypeAtLocation(baseTypeNode);
                        if (classElementModifierFlags & ModifierFlags.Static) {
                            // Use static class to get property symbols from
                            baseClassTypeToGetPropertiesFrom = typeChecker.getTypeOfSymbolAtLocation(
                                baseClassTypeToGetPropertiesFrom.symbol, classLikeDeclaration);
                        }
                    }
                    const implementedInterfaceTypePropertySymbols = (classElementModifierFlags & ModifierFlags.Static) ?
                        emptyArray :
                        flatMap(implementsTypeNodes || emptyArray, typeNode => typeChecker.getPropertiesOfType(typeChecker.getTypeAtLocation(typeNode)));

                    // List of property symbols of base type that are not private and already implemented
                    symbols = filterClassMembersList(
                        baseClassTypeToGetPropertiesFrom ?
                            typeChecker.getPropertiesOfType(baseClassTypeToGetPropertiesFrom) :
                            emptyArray,
                        implementedInterfaceTypePropertySymbols,
                        classLikeDeclaration.members,
                        classElementModifierFlags);
                }
            }
        }

        /**
         * Returns the immediate owning object literal or binding pattern of a context token,
         * on the condition that one exists and that the context implies completion should be given.
         */
        function tryGetObjectLikeCompletionContainer(contextToken: Node): ObjectLiteralExpression | ObjectBindingPattern {
            if (contextToken) {
                switch (contextToken.kind) {
                    case SyntaxKind.OpenBraceToken:  // const x = { |
                    case SyntaxKind.CommaToken:      // const x = { a: 0, |
                        const parent = contextToken.parent;
                        if (isObjectLiteralExpression(parent) || isObjectBindingPattern(parent)) {
                            return parent;
                        }
                        break;
                }
            }

            return undefined;
        }

        /**
         * Returns the containing list of named imports or exports of a context token,
         * on the condition that one exists and that the context implies completion should be given.
         */
        function tryGetNamedImportsOrExportsForCompletion(contextToken: Node): NamedImportsOrExports {
            if (contextToken) {
                switch (contextToken.kind) {
                    case SyntaxKind.OpenBraceToken:  // import { |
                    case SyntaxKind.CommaToken:      // import { a as 0, |
                        switch (contextToken.parent.kind) {
                            case SyntaxKind.NamedImports:
                            case SyntaxKind.NamedExports:
                                return <NamedImportsOrExports>contextToken.parent;
                        }
                }
            }

            return undefined;
        }

        function isFromClassElementDeclaration(node: Node) {
            return isClassElement(node.parent) && isClassLike(node.parent.parent);
        }

        function isParameterOfConstructorDeclaration(node: Node) {
            return isParameter(node) && isConstructorDeclaration(node.parent);
        }

        function isConstructorParameterCompletion(node: Node) {
            return node.parent &&
                isParameterOfConstructorDeclaration(node.parent) &&
                (isConstructorParameterCompletionKeyword(node.kind) || isDeclarationName(node));
        }

        /**
         * Returns the immediate owning class declaration of a context token,
         * on the condition that one exists and that the context implies completion should be given.
         */
        function tryGetClassLikeCompletionContainer(contextToken: Node): ClassLikeDeclaration {
            if (contextToken) {
                switch (contextToken.kind) {
                    case SyntaxKind.OpenBraceToken:  // class c { |
                        if (isClassLike(contextToken.parent)) {
                            return contextToken.parent;
                        }
                        break;

                    // class c {getValue(): number, | }
                    case SyntaxKind.CommaToken:
                        if (isClassLike(contextToken.parent)) {
                            return contextToken.parent;
                        }
                        break;

                    // class c {getValue(): number; | }
                    case SyntaxKind.SemicolonToken:
                    // class c { method() { } | }
                    case SyntaxKind.CloseBraceToken:
                        if (isClassLike(location)) {
                            return location;
                        }
                        // class c { method() { } b| }
                        if (isFromClassElementDeclaration(location) &&
                            (location.parent as ClassElement).name === location) {
                            return location.parent.parent as ClassLikeDeclaration;
                        }
                        break;

                    default:
                        if (isFromClassElementDeclaration(contextToken) &&
                            (isClassMemberCompletionKeyword(contextToken.kind) ||
                                isClassMemberCompletionKeywordText(contextToken.getText()))) {
                            return contextToken.parent.parent as ClassLikeDeclaration;
                        }
                }
            }

            // class c { method() { } | method2() { } }
            if (location && location.kind === SyntaxKind.SyntaxList && isClassLike(location.parent)) {
                return location.parent;
            }
            return undefined;
        }

        /**
         * Returns the immediate owning class declaration of a context token,
         * on the condition that one exists and that the context implies completion should be given.
         */
        function tryGetConstructorLikeCompletionContainer(contextToken: Node): ConstructorDeclaration {
            if (contextToken) {
                switch (contextToken.kind) {
                    case SyntaxKind.OpenParenToken:
                    case SyntaxKind.CommaToken:
                        return isConstructorDeclaration(contextToken.parent) && contextToken.parent;

                    default:
                        if (isConstructorParameterCompletion(contextToken)) {
                            return contextToken.parent.parent as ConstructorDeclaration;
                        }
                }
            }
            return undefined;
        }

        function tryGetFunctionLikeBodyCompletionContainer(contextToken: Node): FunctionLikeDeclaration {
            if (contextToken) {
                let prev: Node;
                const container = findAncestor(contextToken.parent, (node: Node) => {
                    if (isClassLike(node)) {
                        return "quit";
                    }
                    if (isFunctionLikeDeclaration(node) && prev === node.body) {
                        return true;
                    }
                    prev = node;
                });
                return container && container as FunctionLikeDeclaration;
            }
        }

        function tryGetContainingJsxElement(contextToken: Node): JsxOpeningLikeElement {
            if (contextToken) {
                const parent = contextToken.parent;
                switch (contextToken.kind) {
                    case SyntaxKind.LessThanSlashToken:
                    case SyntaxKind.SlashToken:
                    case SyntaxKind.Identifier:
                    case SyntaxKind.PropertyAccessExpression:
                    case SyntaxKind.JsxAttributes:
                    case SyntaxKind.JsxAttribute:
                    case SyntaxKind.JsxSpreadAttribute:
                        if (parent && (parent.kind === SyntaxKind.JsxSelfClosingElement || parent.kind === SyntaxKind.JsxOpeningElement)) {
                            return <JsxOpeningLikeElement>parent;
                        }
                        else if (parent.kind === SyntaxKind.JsxAttribute) {
                            // Currently we parse JsxOpeningLikeElement as:
                            //      JsxOpeningLikeElement
                            //          attributes: JsxAttributes
                            //             properties: NodeArray<JsxAttributeLike>
                            return parent.parent.parent as JsxOpeningLikeElement;
                        }
                        break;

                    // The context token is the closing } or " of an attribute, which means
                    // its parent is a JsxExpression, whose parent is a JsxAttribute,
                    // whose parent is a JsxOpeningLikeElement
                    case SyntaxKind.StringLiteral:
                        if (parent && ((parent.kind === SyntaxKind.JsxAttribute) || (parent.kind === SyntaxKind.JsxSpreadAttribute))) {
                            // Currently we parse JsxOpeningLikeElement as:
                            //      JsxOpeningLikeElement
                            //          attributes: JsxAttributes
                            //             properties: NodeArray<JsxAttributeLike>
                            return parent.parent.parent as JsxOpeningLikeElement;
                        }

                        break;

                    case SyntaxKind.CloseBraceToken:
                        if (parent &&
                            parent.kind === SyntaxKind.JsxExpression &&
                            parent.parent && parent.parent.kind === SyntaxKind.JsxAttribute) {
                            // Currently we parse JsxOpeningLikeElement as:
                            //      JsxOpeningLikeElement
                            //          attributes: JsxAttributes
                            //             properties: NodeArray<JsxAttributeLike>
                            //                  each JsxAttribute can have initializer as JsxExpression
                            return parent.parent.parent.parent as JsxOpeningLikeElement;
                        }

                        if (parent && parent.kind === SyntaxKind.JsxSpreadAttribute) {
                            // Currently we parse JsxOpeningLikeElement as:
                            //      JsxOpeningLikeElement
                            //          attributes: JsxAttributes
                            //             properties: NodeArray<JsxAttributeLike>
                            return parent.parent.parent as JsxOpeningLikeElement;
                        }

                        break;
                }
            }
            return undefined;
        }

        /**
         * @returns true if we are certain that the currently edited location must define a new location; false otherwise.
         */
        function isSolelyIdentifierDefinitionLocation(contextToken: Node): boolean {
            const containingNodeKind = contextToken.parent.kind;
            switch (contextToken.kind) {
                case SyntaxKind.CommaToken:
                    return containingNodeKind === SyntaxKind.VariableDeclaration ||
                        containingNodeKind === SyntaxKind.VariableDeclarationList ||
                        containingNodeKind === SyntaxKind.VariableStatement ||
                        containingNodeKind === SyntaxKind.EnumDeclaration ||                        // enum a { foo, |
                        isFunctionLikeButNotConstructor(containingNodeKind) ||
                        containingNodeKind === SyntaxKind.InterfaceDeclaration ||                   // interface A<T, |
                        containingNodeKind === SyntaxKind.ArrayBindingPattern ||                    // var [x, y|
                        containingNodeKind === SyntaxKind.TypeAliasDeclaration ||                   // type Map, K, |
                        // class A<T, |
                        // var C = class D<T, |
                        (isClassLike(contextToken.parent) &&
                            contextToken.parent.typeParameters &&
                            contextToken.parent.typeParameters.end >= contextToken.pos);

                case SyntaxKind.DotToken:
                    return containingNodeKind === SyntaxKind.ArrayBindingPattern;                   // var [.|

                case SyntaxKind.ColonToken:
                    return containingNodeKind === SyntaxKind.BindingElement;                        // var {x :html|

                case SyntaxKind.OpenBracketToken:
                    return containingNodeKind === SyntaxKind.ArrayBindingPattern;                   // var [x|

                case SyntaxKind.OpenParenToken:
                    return containingNodeKind === SyntaxKind.CatchClause ||
                        isFunctionLikeButNotConstructor(containingNodeKind);

                case SyntaxKind.OpenBraceToken:
                    return containingNodeKind === SyntaxKind.EnumDeclaration ||                     // enum a { |
                        containingNodeKind === SyntaxKind.InterfaceDeclaration ||                   // interface a { |
                        containingNodeKind === SyntaxKind.TypeLiteral;                              // const x : { |

                case SyntaxKind.SemicolonToken:
                    return containingNodeKind === SyntaxKind.PropertySignature &&
                        contextToken.parent && contextToken.parent.parent &&
                        (contextToken.parent.parent.kind === SyntaxKind.InterfaceDeclaration ||    // interface a { f; |
                            contextToken.parent.parent.kind === SyntaxKind.TypeLiteral);           // const x : { a; |

                case SyntaxKind.LessThanToken:
                    return containingNodeKind === SyntaxKind.ClassDeclaration ||                    // class A< |
                        containingNodeKind === SyntaxKind.ClassExpression ||                        // var C = class D< |
                        containingNodeKind === SyntaxKind.InterfaceDeclaration ||                   // interface A< |
                        containingNodeKind === SyntaxKind.TypeAliasDeclaration ||                   // type List< |
                        isFunctionLikeKind(containingNodeKind);

                case SyntaxKind.StaticKeyword:
                    return containingNodeKind === SyntaxKind.PropertyDeclaration && !isClassLike(contextToken.parent.parent);

                case SyntaxKind.DotDotDotToken:
                    return containingNodeKind === SyntaxKind.Parameter ||
                        (contextToken.parent && contextToken.parent.parent &&
                            contextToken.parent.parent.kind === SyntaxKind.ArrayBindingPattern);  // var [...z|

                case SyntaxKind.PublicKeyword:
                case SyntaxKind.PrivateKeyword:
                case SyntaxKind.ProtectedKeyword:
                    return containingNodeKind === SyntaxKind.Parameter && !isConstructorDeclaration(contextToken.parent.parent);

                case SyntaxKind.AsKeyword:
                    return containingNodeKind === SyntaxKind.ImportSpecifier ||
                        containingNodeKind === SyntaxKind.ExportSpecifier ||
                        containingNodeKind === SyntaxKind.NamespaceImport;

                case SyntaxKind.GetKeyword:
                case SyntaxKind.SetKeyword:
                    if (isFromClassElementDeclaration(contextToken)) {
                        return false;
                    }
                // falls through
                case SyntaxKind.ClassKeyword:
                case SyntaxKind.EnumKeyword:
                case SyntaxKind.InterfaceKeyword:
                case SyntaxKind.FunctionKeyword:
                case SyntaxKind.VarKeyword:
                case SyntaxKind.ImportKeyword:
                case SyntaxKind.LetKeyword:
                case SyntaxKind.ConstKeyword:
                case SyntaxKind.YieldKeyword:
                case SyntaxKind.TypeKeyword:  // type htm|
                    return true;
            }

            // If the previous token is keyword correspoding to class member completion keyword
            // there will be completion available here
            if (isClassMemberCompletionKeywordText(contextToken.getText()) &&
                isFromClassElementDeclaration(contextToken)) {
                return false;
            }

            if (isConstructorParameterCompletion(contextToken)) {
                // constructor parameter completion is available only if
                // - its modifier of the constructor parameter or
                // - its name of the parameter and not being edited
                // eg. constructor(a |<- this shouldnt show completion
                if (!isIdentifier(contextToken) ||
                    isConstructorParameterCompletionKeywordText(contextToken.getText()) ||
                    isCurrentlyEditingNode(contextToken)) {
                    return false;
                }
            }

            // Previous token may have been a keyword that was converted to an identifier.
            switch (contextToken.getText()) {
                case "abstract":
                case "async":
                case "class":
                case "const":
                case "declare":
                case "enum":
                case "function":
                case "interface":
                case "let":
                case "private":
                case "protected":
                case "public":
                case "static":
                case "var":
                case "yield":
                    return true;
            }

            return isDeclarationName(contextToken)
                && !isJsxAttribute(contextToken.parent)
                // Don't block completions if we're in `class C /**/`, because we're *past* the end of the identifier and might want to complete `extends`.
                // If `contextToken !== previousToken`, this is `class C ex/**/`.
                && !(isClassLike(contextToken.parent) && (contextToken !== previousToken || position > previousToken.end));
        }

        function isFunctionLikeButNotConstructor(kind: SyntaxKind) {
            return isFunctionLikeKind(kind) && kind !== SyntaxKind.Constructor;
        }

        function isDotOfNumericLiteral(contextToken: Node): boolean {
            if (contextToken.kind === SyntaxKind.NumericLiteral) {
                const text = contextToken.getFullText();
                return text.charAt(text.length - 1) === ".";
            }

            return false;
        }

        /**
         * Filters out completion suggestions for named imports or exports.
         *
         * @param exportsOfModule          The list of symbols which a module exposes.
         * @param namedImportsOrExports    The list of existing import/export specifiers in the import/export clause.
         *
         * @returns Symbols to be suggested at an import/export clause, barring those whose named imports/exports
         *          do not occur at the current position and have not otherwise been typed.
         */
        function filterNamedImportOrExportCompletionItems(exportsOfModule: Symbol[], namedImportsOrExports: ReadonlyArray<ImportOrExportSpecifier>): Symbol[] {
            const existingImportsOrExports = createUnderscoreEscapedMap<boolean>();

            for (const element of namedImportsOrExports) {
                // If this is the current item we are editing right now, do not filter it out
                if (isCurrentlyEditingNode(element)) {
                    continue;
                }

                const name = element.propertyName || element.name;
                existingImportsOrExports.set(name.escapedText, true);
            }

            if (existingImportsOrExports.size === 0) {
                return filter(exportsOfModule, e => e.escapedName !== InternalSymbolName.Default);
            }

            return filter(exportsOfModule, e => e.escapedName !== InternalSymbolName.Default && !existingImportsOrExports.get(e.escapedName));
        }

        /**
         * Filters out completion suggestions for named imports or exports.
         *
         * @returns Symbols to be suggested in an object binding pattern or object literal expression, barring those whose declarations
         *          do not occur at the current position and have not otherwise been typed.
         */
        function filterObjectMembersList(contextualMemberSymbols: Symbol[], existingMembers: ReadonlyArray<Declaration>): Symbol[] {
            if (!existingMembers || existingMembers.length === 0) {
                return contextualMemberSymbols;
            }

            const existingMemberNames = createUnderscoreEscapedMap<boolean>();
            for (const m of existingMembers) {
                // Ignore omitted expressions for missing members
                if (m.kind !== SyntaxKind.PropertyAssignment &&
                    m.kind !== SyntaxKind.ShorthandPropertyAssignment &&
                    m.kind !== SyntaxKind.BindingElement &&
                    m.kind !== SyntaxKind.MethodDeclaration &&
                    m.kind !== SyntaxKind.GetAccessor &&
                    m.kind !== SyntaxKind.SetAccessor) {
                    continue;
                }

                // If this is the current item we are editing right now, do not filter it out
                if (isCurrentlyEditingNode(m)) {
                    continue;
                }

                let existingName: __String;

                if (m.kind === SyntaxKind.BindingElement && (<BindingElement>m).propertyName) {
                    // include only identifiers in completion list
                    if ((<BindingElement>m).propertyName.kind === SyntaxKind.Identifier) {
                        existingName = (<Identifier>(<BindingElement>m).propertyName).escapedText;
                    }
                }
                else {
                    // TODO: Account for computed property name
                    // NOTE: if one only performs this step when m.name is an identifier,
                    // things like '__proto__' are not filtered out.
                    const name = getNameOfDeclaration(m);
                    existingName = getEscapedTextOfIdentifierOrLiteral(name as (Identifier | LiteralExpression));
                }

                existingMemberNames.set(existingName, true);
            }

            return filter(contextualMemberSymbols, m => !existingMemberNames.get(m.escapedName));
        }

        /**
         * Filters out completion suggestions for class elements.
         *
         * @returns Symbols to be suggested in an class element depending on existing memebers and symbol flags
         */
        function filterClassMembersList(
            baseSymbols: ReadonlyArray<Symbol>,
            implementingTypeSymbols: ReadonlyArray<Symbol>,
            existingMembers: ReadonlyArray<ClassElement>,
            currentClassElementModifierFlags: ModifierFlags): Symbol[] {
            const existingMemberNames = createUnderscoreEscapedMap<boolean>();
            for (const m of existingMembers) {
                // Ignore omitted expressions for missing members
                if (m.kind !== SyntaxKind.PropertyDeclaration &&
                    m.kind !== SyntaxKind.MethodDeclaration &&
                    m.kind !== SyntaxKind.GetAccessor &&
                    m.kind !== SyntaxKind.SetAccessor) {
                    continue;
                }

                // If this is the current item we are editing right now, do not filter it out
                if (isCurrentlyEditingNode(m)) {
                    continue;
                }

                // Dont filter member even if the name matches if it is declared private in the list
                if (hasModifier(m, ModifierFlags.Private)) {
                    continue;
                }

                // do not filter it out if the static presence doesnt match
                const mIsStatic = hasModifier(m, ModifierFlags.Static);
                const currentElementIsStatic = !!(currentClassElementModifierFlags & ModifierFlags.Static);
                if ((mIsStatic && !currentElementIsStatic) ||
                    (!mIsStatic && currentElementIsStatic)) {
                    continue;
                }

                const existingName = getPropertyNameForPropertyNameNode(m.name);
                if (existingName) {
                    existingMemberNames.set(existingName, true);
                }
            }

            const result: Symbol[] = [];
            addPropertySymbols(baseSymbols, ModifierFlags.Private);
            addPropertySymbols(implementingTypeSymbols, ModifierFlags.NonPublicAccessibilityModifier);
            return result;

            function addPropertySymbols(properties: ReadonlyArray<Symbol>, inValidModifierFlags: ModifierFlags) {
                for (const property of properties) {
                    if (isValidProperty(property, inValidModifierFlags)) {
                        result.push(property);
                    }
                }
            }

            function isValidProperty(propertySymbol: Symbol, inValidModifierFlags: ModifierFlags) {
                return !existingMemberNames.get(propertySymbol.escapedName) &&
                    propertySymbol.getDeclarations() &&
                    !(getDeclarationModifierFlagsFromSymbol(propertySymbol) & inValidModifierFlags);
            }
        }

        /**
         * Filters out completion suggestions from 'symbols' according to existing JSX attributes.
         *
         * @returns Symbols to be suggested in a JSX element, barring those whose attributes
         *          do not occur at the current position and have not otherwise been typed.
         */
        function filterJsxAttributes(symbols: Symbol[], attributes: NodeArray<JsxAttribute | JsxSpreadAttribute>): Symbol[] {
            const seenNames = createUnderscoreEscapedMap<boolean>();
            for (const attr of attributes) {
                // If this is the current item we are editing right now, do not filter it out
                if (isCurrentlyEditingNode(attr)) {
                    continue;
                }

                if (attr.kind === SyntaxKind.JsxAttribute) {
                    seenNames.set((<JsxAttribute>attr).name.escapedText, true);
                }
            }

            return filter(symbols, a => !seenNames.get(a.escapedName));
        }

        function isCurrentlyEditingNode(node: Node): boolean {
            return node.getStart() <= position && position <= node.getEnd();
        }
    }

    interface CompletionEntryDisplayNameForSymbol {
        readonly name: string;
        readonly needsConvertPropertyAccess: boolean;
    }
    function getCompletionEntryDisplayNameForSymbol(
        symbol: Symbol,
        target: ScriptTarget,
        origin: SymbolOriginInfo | undefined,
        kind: CompletionKind,
    ): CompletionEntryDisplayNameForSymbol | undefined {
        const name = getSymbolName(symbol, origin, target);
        if (name === undefined
            // If the symbol is external module, don't show it in the completion list
            // (i.e declare module "http" { const x; } | // <= request completion here, "http" should not be there)
            || symbol.flags & SymbolFlags.Module && startsWithQuote(name)
            // If the symbol is the internal name of an ES symbol, it is not a valid entry. Internal names for ES symbols start with "__@"
            || isKnownSymbol(symbol)) {
            return undefined;
        }

        const validIdentiferResult: CompletionEntryDisplayNameForSymbol = { name, needsConvertPropertyAccess: false };
        if (isIdentifierText(name, target)) return validIdentiferResult;
        switch (kind) {
            case CompletionKind.MemberLike:
                return undefined;
            case CompletionKind.ObjectPropertyDeclaration:
                // TODO: GH#18169
                return { name: JSON.stringify(name), needsConvertPropertyAccess: false };
            case CompletionKind.PropertyAccess:
            case CompletionKind.None:
            case CompletionKind.Global:
                // Don't add a completion for a name starting with a space. See https://github.com/Microsoft/TypeScript/pull/20547
                return name.charCodeAt(0) === CharacterCodes.space ? undefined : { name, needsConvertPropertyAccess: true };
            case CompletionKind.String:
                return validIdentiferResult;
            default:
                Debug.assertNever(kind);
        }
    }

    // A cache of completion entries for keywords, these do not change between sessions
    const _keywordCompletions: ReadonlyArray<CompletionEntry>[] = [];
    const allKeywordsCompletions: () => ReadonlyArray<CompletionEntry> = ts.memoize(() => {
        const res: CompletionEntry[] = [];
        for (let i = SyntaxKind.FirstKeyword; i <= SyntaxKind.LastKeyword; i++) {
            res.push({
                name: tokenToString(i),
                kind: ScriptElementKind.keyword,
                kindModifiers: ScriptElementKindModifier.none,
                sortText: "0"
            });
        }
        return res;
    });
    function getKeywordCompletions(keywordFilter: KeywordCompletionFilters): ReadonlyArray<CompletionEntry> {
        return _keywordCompletions[keywordFilter] || (_keywordCompletions[keywordFilter] = allKeywordsCompletions().filter(entry => {
            const kind = stringToToken(entry.name);
            switch (keywordFilter) {
                case KeywordCompletionFilters.None:
                    // "undefined" is a global variable, so don't need a keyword completion for it.
                    return kind !== SyntaxKind.UndefinedKeyword;
                case KeywordCompletionFilters.ClassElementKeywords:
                    return isClassMemberCompletionKeyword(kind);
                case KeywordCompletionFilters.ConstructorParameterKeywords:
                    return isConstructorParameterCompletionKeyword(kind);
                case KeywordCompletionFilters.FunctionLikeBodyKeywords:
                    return isFunctionLikeBodyCompletionKeyword(kind);
                case KeywordCompletionFilters.TypeKeywords:
                    return isTypeKeyword(kind);
                default:
                    return Debug.assertNever(keywordFilter);
            }
        }));
    }

    function isClassMemberCompletionKeyword(kind: SyntaxKind) {
        switch (kind) {
            case SyntaxKind.PublicKeyword:
            case SyntaxKind.ProtectedKeyword:
            case SyntaxKind.PrivateKeyword:
            case SyntaxKind.AbstractKeyword:
            case SyntaxKind.StaticKeyword:
            case SyntaxKind.ConstructorKeyword:
            case SyntaxKind.ReadonlyKeyword:
            case SyntaxKind.GetKeyword:
            case SyntaxKind.SetKeyword:
            case SyntaxKind.AsyncKeyword:
                return true;
        }
    }

    function isClassMemberCompletionKeywordText(text: string) {
        return isClassMemberCompletionKeyword(stringToToken(text));
    }

    function isConstructorParameterCompletionKeyword(kind: SyntaxKind) {
        switch (kind) {
            case SyntaxKind.PublicKeyword:
            case SyntaxKind.PrivateKeyword:
            case SyntaxKind.ProtectedKeyword:
            case SyntaxKind.ReadonlyKeyword:
                return true;
        }
    }

    function isConstructorParameterCompletionKeywordText(text: string) {
        return isConstructorParameterCompletionKeyword(stringToToken(text));
    }

    function isFunctionLikeBodyCompletionKeyword(kind: SyntaxKind) {
        switch (kind) {
            case SyntaxKind.PublicKeyword:
            case SyntaxKind.PrivateKeyword:
            case SyntaxKind.ProtectedKeyword:
            case SyntaxKind.ReadonlyKeyword:
            case SyntaxKind.ConstructorKeyword:
            case SyntaxKind.StaticKeyword:
            case SyntaxKind.AbstractKeyword:
            case SyntaxKind.GetKeyword:
            case SyntaxKind.SetKeyword:
            case SyntaxKind.UndefinedKeyword:
                return false;
        }
        return true;
    }

    function isEqualityOperatorKind(kind: ts.SyntaxKind): kind is EqualityOperator {
        switch (kind) {
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsToken:
                return true;
            default:
                return false;
        }
    }

    /** Get the corresponding JSDocTag node if the position is in a jsDoc comment */
    function getJsDocTagAtPosition(node: Node, position: number): JSDocTag | undefined {
        const { jsDoc } = getJsDocHavingNode(node) as JSDocContainer;
        if (!jsDoc) return undefined;

        for (const { pos, end, tags } of jsDoc) {
            if (!tags || position < pos || position > end) continue;
            for (let i = tags.length - 1; i >= 0; i--) {
                const tag = tags[i];
                if (position >= tag.pos) {
                    return tag;
                }
            }
        }
    }

    function getJsDocHavingNode(node: Node): Node {
        if (!isToken(node)) return node;

        switch (node.kind) {
            case SyntaxKind.VarKeyword:
            case SyntaxKind.LetKeyword:
            case SyntaxKind.ConstKeyword:
                // if the current token is var, let or const, skip the VariableDeclarationList
                return node.parent.parent;
            default:
                return node.parent;
        }
    }

    /**
     * Gets all properties on a type, but if that type is a union of several types,
     * excludes array-like types or callable/constructable types.
     */
    function getPropertiesForCompletion(type: Type, checker: TypeChecker, isForAccess: boolean): Symbol[] {
        if (!(type.flags & TypeFlags.Union)) {
            return type.getApparentProperties();
        }

        const { types } = type as UnionType;
        // If we're providing completions for an object literal, skip primitive, array-like, or callable types since those shouldn't be implemented by object literals.
        const filteredTypes = isForAccess ? types : types.filter(memberType =>
            !(memberType.flags & TypeFlags.Primitive || checker.isArrayLikeType(memberType) || typeHasCallOrConstructSignatures(memberType, checker)));
        return checker.getAllPossiblePropertiesOfTypes(filteredTypes);
    }
}
