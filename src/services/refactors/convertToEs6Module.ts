/* @internal */
namespace ts.refactor {
    const actionName = "Convert to ES6 module";
    const description = getLocaleSpecificMessage(Diagnostics.Convert_to_ES6_module);
    registerRefactor(actionName, { getEditsForAction, getAvailableActions });

    function getAvailableActions(context: RefactorContext): ApplicableRefactorInfo[] | undefined {
        const { file, startPosition } = context;
        if (!isSourceFileJavaScript(file) || !file.commonJsModuleIndicator) {
            return undefined;
        }

        const node = getTokenAtPosition(file, startPosition, /*includeJsDocComment*/ false);
        return !isAtTriggerLocation(file, node) ? undefined : [
            {
                name: actionName,
                description,
                actions: [
                    {
                        description,
                        name: actionName,
                    },
                ],
            },
        ];
    }

    function isAtTriggerLocation(sourceFile: SourceFile, node: Node, onSecondTry = false): boolean {
        switch (node.kind) {
            case SyntaxKind.CallExpression:
                return isAtTopLevelRequire(node as CallExpression);
            case SyntaxKind.PropertyAccessExpression:
                return isExportsOrModuleExportsOrAlias(sourceFile, node as PropertyAccessExpression)
                    || isExportsOrModuleExportsOrAlias(sourceFile, (node as PropertyAccessExpression).expression);
            case SyntaxKind.VariableDeclarationList:
                const decl = (node as VariableDeclarationList).declarations[0];
                return isExportsOrModuleExportsOrAlias(sourceFile, decl.initializer);
            case SyntaxKind.VariableDeclaration:
                return isExportsOrModuleExportsOrAlias(sourceFile, (node as VariableDeclaration).initializer);
            default:
                return isExpression(node) && isExportsOrModuleExportsOrAlias(sourceFile, node)
                    || !onSecondTry && isAtTriggerLocation(sourceFile, node.parent, /*onSecondTry*/ true);
        }
    }

    function isAtTopLevelRequire(call: CallExpression): boolean {
        if (!isRequireCall(call, /*checkArgumentIsStringLiteral*/ true)) {
            return false;
        }
        const { parent: propAccess } = call;
        const varDecl = isPropertyAccessExpression(propAccess) ? propAccess.parent : propAccess;
        if (isExpressionStatement(varDecl) && isSourceFile(varDecl.parent)) { // `require("x");` as a statement
            return true;
        }
        if (!isVariableDeclaration(varDecl)) {
            return false;
        }
        const { parent: varDeclList } = varDecl;
        if (varDeclList.kind !== SyntaxKind.VariableDeclarationList) {
            return false;
        }
        const { parent: varStatement } = varDeclList;
        return varStatement.kind === SyntaxKind.VariableStatement && varStatement.parent.kind === SyntaxKind.SourceFile;
    }

    function getEditsForAction(context: RefactorContext, _actionName: string): RefactorEditInfo | undefined {
        Debug.assertEqual(actionName, _actionName);
        const { file, program } = context;
        Debug.assert(isSourceFileJavaScript(file));
        const edits = textChanges.ChangeTracker.with(context, changes => {
            const moduleExportsChangedToDefault = convertFileToEs6Module(file, program.getTypeChecker(), changes, program.getCompilerOptions().target);
            if (moduleExportsChangedToDefault) {
                for (const importingFile of program.getSourceFiles()) {
                    fixImportOfModuleExports(importingFile, file, changes);
                }
            }
        });
        return { edits, renameFilename: undefined, renameLocation: undefined };
    }

    function fixImportOfModuleExports(importingFile: ts.SourceFile, exportingFile: ts.SourceFile, changes: textChanges.ChangeTracker) {
        for (const moduleSpecifier of importingFile.imports) {
            const imported = getResolvedModule(importingFile, moduleSpecifier.text);
            if (!imported || imported.resolvedFileName !== exportingFile.fileName) {
                continue;
            }

            const { parent } = moduleSpecifier;
            switch (parent.kind) {
                case SyntaxKind.ExternalModuleReference: {
                    const importEq = (parent as ExternalModuleReference).parent;
                    changes.replaceNode(importingFile, importEq, makeImport(importEq.name, /*namedImports*/ undefined, moduleSpecifier.text));
                    break;
                }
                case SyntaxKind.CallExpression: {
                    const call = parent as CallExpression;
                    if (isRequireCall(call, /*checkArgumentIsStringLiteral*/ false)) {
                        changes.replaceNode(importingFile, parent, createPropertyAccess(getSynthesizedDeepClone(call), "default"));
                    }
                    break;
                }
            }
        }
    }

    /** @returns Whether we converted a `module.exports =` to a default export. */
    function convertFileToEs6Module(sourceFile: SourceFile, checker: TypeChecker, changes: textChanges.ChangeTracker, target: ScriptTarget): ModuleExportsChanged {
        const identifiers: Identifiers = { original: collectFreeIdentifiers(sourceFile), additional: createMap<true>() };
        const exports = collectExportRenames(sourceFile, checker, identifiers);
        convertExportsAccesses(sourceFile, exports, changes);
        let moduleExportsChangedToDefault = false;
        for (const statement of sourceFile.statements) {
            const moduleExportsChanged = convertStatement(sourceFile, statement, checker, changes, identifiers, target, exports);
            moduleExportsChangedToDefault = moduleExportsChangedToDefault || moduleExportsChanged;
        }
        return moduleExportsChangedToDefault;
    }

    /**
     * Contains an entry for each renamed export.
     * This is necessary because `exports.x = 0;` does not declare a local variable.
     * Converting this to `export const x = 0;` would declare a local, so we must be careful to avoid shadowing.
     * If there would be shadowing at either the declaration or at any reference to `exports.x` (now just `x`), we must convert to:
     *     const _x = 0;
     *     export { _x as x };
     * This conversion also must place if the exported name is not a valid identifier, e.g. `exports.class = 0;`.
     */
    type ExportRenames = ReadonlyMap<string>;

    function collectExportRenames(sourceFile: SourceFile, checker: TypeChecker, identifiers: Identifiers): ExportRenames {
        const res = createMap<string>();
        forEachExportReference(sourceFile, node => {
            const { text, originalKeywordKind } = node.name;
            if (!res.has(text) && (originalKeywordKind !== undefined && isNonContextualKeyword(originalKeywordKind)
                || checker.resolveName(node.name.text, node, SymbolFlags.Value, /*excludeGlobals*/ true))) {
                // Unconditionally add an underscore in case `text` is a keyword.
                res.set(text, makeUniqueName(`_${text}`, identifiers));
            }
        });
        return res;
    }

    function convertExportsAccesses(sourceFile: SourceFile, exports: ExportRenames, changes: textChanges.ChangeTracker): void {
        forEachExportReference(sourceFile, (node, isAssignmentLhs) => {
            if (isAssignmentLhs) {
                return;
            }
            const { text } = node.name;
            changes.replaceNode(sourceFile, node, createIdentifier(exports.get(text) || text));
        });
    }

    function forEachExportReference(sourceFile: SourceFile, cb: (node: PropertyAccessExpression, isAssignmentLhs: boolean) => void): void {
        sourceFile.forEachChild(function recur(node) {
            if (isPropertyAccessExpression(node) && isExportsOrModuleExportsOrAlias(sourceFile, node.expression)) {
                const { parent } = node;
                cb(node, isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === SyntaxKind.EqualsToken);
            }
            node.forEachChild(recur);
        });
    }

    /** Whether `module.exports =` was changed to `export default` */
    type ModuleExportsChanged = boolean;

    function convertStatement(sourceFile: SourceFile, statement: Statement, checker: TypeChecker, changes: textChanges.ChangeTracker, identifiers: Identifiers, target: ScriptTarget, exports: ExportRenames): ModuleExportsChanged {
        switch (statement.kind) {
            case SyntaxKind.VariableStatement:
                convertVariableStatement(sourceFile, statement as VariableStatement, changes, checker, identifiers, target);
                return false;
            case SyntaxKind.ExpressionStatement: {
                const { expression } = statement as ExpressionStatement;
                switch (expression.kind) {
                    case SyntaxKind.CallExpression: {
                        if (isRequireCall(expression, /*checkArgumentIsStringLiteral*/ true)) {
                            // For side-effecting require() call, just make a side-effecting import.
                            changes.replaceNode(sourceFile, statement, makeImport(/*name*/ undefined, /*namedImports*/ undefined, expression.arguments[0].text));
                        }
                        return false;
                    }
                    case SyntaxKind.BinaryExpression: {
                        const { left, operatorToken, right } = expression as BinaryExpression;
                        return operatorToken.kind === SyntaxKind.EqualsToken && convertAssignment(sourceFile, checker, statement as ExpressionStatement, left, right, changes, exports);
                    }
                }
            }
            // falls through
            default:
                return false;
        }
    }

    function convertVariableStatement(sourceFile: SourceFile, statement: VariableStatement, changes: textChanges.ChangeTracker, checker: TypeChecker, identifiers: Identifiers, target: ScriptTarget): void {
        const { declarationList } = statement as VariableStatement;
        let foundImport = false;
        const newNodes = flatMap(declarationList.declarations, decl => {
            const { name, initializer } = decl;
            if (isExportsOrModuleExportsOrAlias(sourceFile, initializer)) {
                // `const alias = module.exports;` can be removed.
                foundImport = true;
                return [];
            }
            if (isRequireCall(initializer, /*checkArgumentIsStringLiteral*/ true)) {
                foundImport = true;
                return convertSingleImport(sourceFile, name, initializer.arguments[0].text, changes, checker, identifiers, target);
            }
            else if (isPropertyAccessExpression(initializer) && isRequireCall(initializer.expression, /*checkArgumentIsStringLiteral*/ true)) {
                foundImport = true;
                return convertPropertyAccessImport(name, initializer.name.text, initializer.expression.arguments[0].text, identifiers);
            }
            else {
                // Move it out to its own variable statement.
                return createVariableStatement(/*modifiers*/ undefined, createVariableDeclarationList([decl], declarationList.flags));
            }
        });
        if (foundImport) {
            // useNonAdjustedEndPosition to ensure we don't eat the newline after the statement.
            changes.replaceNodeWithNodes(sourceFile, statement, newNodes);
        }
    }

    /** Converts `const name = require("moduleSpecifier").propertyName` */
    function convertPropertyAccessImport(name: BindingName, propertyName: string, moduleSpecifier: string, identifiers: Identifiers): ReadonlyArray<Node> {
        switch (name.kind) {
            case SyntaxKind.ObjectBindingPattern:
            case SyntaxKind.ArrayBindingPattern: {
                // `const [a, b] = require("c").d` --> `import { d } from "c"; const [a, b] = d;`
                const tmp  = makeUniqueName(propertyName, identifiers);
                return [
                    makeSingleImport(tmp, propertyName, moduleSpecifier),
                    makeConst(/*modifiers*/ undefined, name, createIdentifier(tmp)),
                ];
            }
            case SyntaxKind.Identifier:
                // `const a = require("b").c` --> `import { c as a } from "./b";
                return [makeSingleImport(name.text, propertyName, moduleSpecifier)];
            default:
                Debug.assertNever(name);
        }
    }

    function convertAssignment(
        sourceFile: SourceFile,
        checker: TypeChecker,
        statement: ExpressionStatement,
        left: Expression,
        right: Expression,
        changes: textChanges.ChangeTracker,
        exports: ExportRenames,
    ): ModuleExportsChanged {
        if (!isPropertyAccessExpression(left)) {
            return false;
        }

        if (isExportsOrModuleExportsOrAlias(sourceFile, left)) {
            if (isExportsOrModuleExportsOrAlias(sourceFile, right)) {
                // `const alias = module.exports;` or `module.exports = alias;` can be removed.
                changes.deleteNode(sourceFile, statement);
            }
            else {
                let newNodes = isObjectLiteralExpression(right) ? tryChangeModuleExportsObject(right) : undefined;
                let changedToDefaultExport = false;
                if (!newNodes) {
                    ([newNodes, changedToDefaultExport] = convertModuleExportsToExportDefault(right, checker));
                }
                changes.replaceNodeWithNodes(sourceFile, statement, newNodes);
                return changedToDefaultExport;
            }
        }
        else if (isExportsOrModuleExportsOrAlias(sourceFile, left.expression)) {
            convertNamedExport(sourceFile, statement, left.name, right, changes, exports);
        }

        return false;
    }

    /**
     * Convert `module.exports = { ... }` to individual exports..
     * We can't always do this if the module has interesting members -- then it will be a default export instead.
     */
    function tryChangeModuleExportsObject(object: ObjectLiteralExpression): ReadonlyArray<Statement> | undefined {
        return mapAllOrFail(object.properties, prop => {
            switch (prop.kind) {
                case SyntaxKind.GetAccessor:
                case SyntaxKind.SetAccessor:
                // TODO: Maybe we should handle this? See fourslash test `refactorConvertToEs6Module_export_object_shorthand.ts`.
                case SyntaxKind.ShorthandPropertyAssignment:
                case SyntaxKind.SpreadAssignment:
                    return undefined;
                case SyntaxKind.PropertyAssignment: {
                    const { name, initializer } = prop as PropertyAssignment;
                    return !isIdentifier(name) ? undefined : convertExportsDotXEquals(name.text, initializer);
                }
                case SyntaxKind.MethodDeclaration: {
                    const m = prop as MethodDeclaration;
                    return !isIdentifier(m.name) ? undefined : functionExpressionToDeclaration(m.name.text, [createToken(SyntaxKind.ExportKeyword)], m);
                }
                default:
                    Debug.assertNever(prop);
            }
        });
    }

    function convertNamedExport(
        sourceFile: SourceFile,
        statement: Statement,
        propertyName: Identifier,
        right: Expression,
        changes: textChanges.ChangeTracker,
        exports: ExportRenames,
    ): void {
        // If "originalKeywordKind" was set, this is e.g. `exports.
        const { text } = propertyName;
        const rename = exports.get(text);
        if (rename !== undefined) {
            /*
            const _class = 0;
            export { _class as class };
            */
            const newNodes = [
                makeConst(/*modifiers*/ undefined, rename, right),
                makeExportDeclaration([createExportSpecifier(rename, text)]),
            ];
            changes.replaceNodeWithNodes(sourceFile, statement, newNodes);
        }
        else {
            changes.replaceNode(sourceFile, statement, convertExportsDotXEquals(text, right), { useNonAdjustedEndPosition: true });
        }
    }

    function convertModuleExportsToExportDefault(exported: Expression, checker: TypeChecker): [ReadonlyArray<Statement>, ModuleExportsChanged] {
        const modifiers = [createToken(SyntaxKind.ExportKeyword), createToken(SyntaxKind.DefaultKeyword)];
        switch (exported.kind) {
            case SyntaxKind.FunctionExpression:
            case SyntaxKind.ArrowFunction: {
                // `module.exports = function f() {}` --> `export default function f() {}`
                const fn = exported as FunctionExpression | ArrowFunction;
                return [[functionExpressionToDeclaration(fn.name && fn.name.text, modifiers, fn)], true];
            }
            case SyntaxKind.ClassExpression: {
                // `module.exports = class C {}` --> `export default class C {}`
                const cls = exported as ClassExpression;
                return [[classExpressionToDeclaration(cls.name && cls.name.text, modifiers, cls)], true];
            }
            case SyntaxKind.CallExpression:
                if (isRequireCall(exported, /*checkArgumentIsStringLiteral*/ true)) {
                    return convertReExportAll(exported.arguments[0], checker);
                }
                // falls through
            default:
                // `module.exports = 0;` --> `export default 0;`
                return [[createExportAssignment(/*decorators*/ undefined, /*modifiers*/ undefined, /*isExportEquals*/ false, exported)], true];
        }
    }

    function convertReExportAll(reExported: StringLiteralLike, checker: TypeChecker): [ReadonlyArray<Statement>, ModuleExportsChanged] {
        // `module.exports = require("x");` ==> `export * from "x"; export { default } from "x";`
        const moduleSpecifier = reExported.text;
        const moduleSymbol = checker.getSymbolAtLocation(reExported);
        const exports = moduleSymbol ? moduleSymbol.exports : emptyUnderscoreEscapedMap;
        return exports.has("export=" as __String)
            ? [[reExportDefault(moduleSpecifier)], true]
            : !exports.has("default" as __String)
            ? [[reExportStar(moduleSpecifier)], false]
            // If there's some non-default export, must include both `export *` and `export default`.
            : exports.size > 1 ? [[reExportStar(moduleSpecifier), reExportDefault(moduleSpecifier)], true] : [[reExportDefault(moduleSpecifier)], true];
    }
    function reExportStar(moduleSpecifier: string): ExportDeclaration {
        return makeExportDeclaration(/*exportClause*/ undefined, moduleSpecifier);
    }
    function reExportDefault(moduleSpecifier: string): ExportDeclaration {
        return makeExportDeclaration([createExportSpecifier(/*propertyName*/ undefined, "default")], moduleSpecifier);
    }

    function convertExportsDotXEquals(name: string | undefined, exported: Expression): Statement {
        const modifiers = [createToken(SyntaxKind.ExportKeyword)];
        switch (exported.kind) {
            case SyntaxKind.FunctionExpression:
            case SyntaxKind.ArrowFunction:
                // `exports.f = function() {}` --> `export function f() {}`
                return functionExpressionToDeclaration(name, modifiers, exported as FunctionExpression | ArrowFunction);
            case SyntaxKind.ClassExpression:
                // `exports.C = class {}` --> `export class C {}`
                return classExpressionToDeclaration(name, modifiers, exported as ClassExpression);
            default:
                // `exports.x = 0;` --> `export const x = 0;`
                return makeConst(modifiers, createIdentifier(name), exported);
        }
    }

    /**
     * Converts `const <<name>> = require("x");`.
     * Returns nodes that will replace the variable declaration for the commonjs import.
     * May also make use `changes` to remove qualifiers at the use sites of imports, to change `mod.x` to `x`.
     */
    function convertSingleImport(
        file: SourceFile,
        name: BindingName,
        moduleSpecifier: string,
        changes: textChanges.ChangeTracker,
        checker: TypeChecker,
        identifiers: Identifiers,
        target: ScriptTarget,
    ): ReadonlyArray<Node> {
        switch (name.kind) {
            case SyntaxKind.ObjectBindingPattern: {
                const importSpecifiers = mapAllOrFail(name.elements, e =>
                    e.dotDotDotToken || e.initializer || e.propertyName && !isIdentifier(e.propertyName) || !isIdentifier(e.name)
                        ? undefined
                        : makeImportSpecifier(e.propertyName && (e.propertyName as Identifier).text, e.name.text));
                if (importSpecifiers) {
                    return [makeImport(/*name*/ undefined, importSpecifiers, moduleSpecifier)];
                }
            }
            // falls through -- object destructuring has an interesting pattern and must be a variable declaration
            case SyntaxKind.ArrayBindingPattern: {
                /*
                import x from "x";
                const [a, b, c] = x;
                */
                const tmp = makeUniqueName(codefix.moduleSpecifierToValidIdentifier(moduleSpecifier, target), identifiers);
                return [
                    makeImport(createIdentifier(tmp), /*namedImports*/ undefined, moduleSpecifier),
                    makeConst(/*modifiers*/ undefined, getSynthesizedDeepClone(name), createIdentifier(tmp)),
                ];
            }
            case SyntaxKind.Identifier:
                return convertSingleIdentifierImport(file, name, moduleSpecifier, changes, checker, identifiers);
            default:
                Debug.assertNever(name);
        }
    }

    /**
     * Convert `import x = require("x").`
     * Also converts uses like `x.y()` to `y()` and uses a named import.
     */
    function convertSingleIdentifierImport(file: SourceFile, name: Identifier, moduleSpecifier: string, changes: textChanges.ChangeTracker, checker: TypeChecker, identifiers: Identifiers): ReadonlyArray<Node> {
        const nameSymbol = checker.getSymbolAtLocation(name);
        // Maps from module property name to name actually used. (The same if there isn't shadowing.)
        const namedBindingsNames = createMap<string>();
        // True if there is some non-property use like `x()` or `f(x)`.
        let needDefaultImport = false;

        for (const use of identifiers.original.get(name.text)) {
            if (checker.getSymbolAtLocation(use) !== nameSymbol || use === name) {
                // This was a use of a different symbol with the same name, due to shadowing. Ignore.
                continue;
            }

            const { parent } = use;
            if (isPropertyAccessExpression(parent)) {
                const { expression, name: { text: propertyName } } = parent;
                Debug.assert(expression === use); // Else shouldn't have been in `collectIdentifiers`
                let idName = namedBindingsNames.get(propertyName);
                if (idName === undefined) {
                    idName = makeUniqueName(propertyName, identifiers);
                    namedBindingsNames.set(propertyName, idName);
                }
                changes.replaceNode(file, parent, createIdentifier(idName));
            }
            else {
                needDefaultImport = true;
            }
        }

        const namedBindings = namedBindingsNames.size === 0 ? undefined : arrayFrom(mapIterator(namedBindingsNames.entries(), ([propertyName, idName]) =>
            createImportSpecifier(propertyName === idName ? undefined : createIdentifier(propertyName), createIdentifier(idName))));
        if (!namedBindings) {
            // If it was unused, ensure that we at least import *something*.
            needDefaultImport = true;
        }
        return [makeImport(needDefaultImport ? getSynthesizedDeepClone(name) : undefined, namedBindings, moduleSpecifier)];
    }

    // Identifiers helpers

    function makeUniqueName(name: string, identifiers: Identifiers): string {
        while (identifiers.original.has(name) || identifiers.additional.has(name)) {
            name = `_${name}`;
        }
        identifiers.additional.set(name, true);
        return name;
    }

    /**
     * Helps us create unique identifiers.
     * `original` refers to the local variable names in the original source file.
     * `additional` is any new unique identifiers we've generated. (e.g., we'll generate `_x`, then `__x`.)
     */
    interface Identifiers {
        readonly original: FreeIdentifiers;
        // Additional identifiers we've added. Mutable!
        readonly additional: Map<true>;
    }

    type FreeIdentifiers = ReadonlyMap<ReadonlyArray<Identifier>>;
    function collectFreeIdentifiers(file: SourceFile): FreeIdentifiers {
        const map = createMultiMap<Identifier>();
        file.forEachChild(function recur(node) {
            if (isIdentifier(node) && isFreeIdentifier(node)) {
                map.add(node.text, node);
            }
            node.forEachChild(recur);
        });
        return map;
    }

    function isFreeIdentifier(node: Identifier): boolean {
        const { parent } = node;
        switch (parent.kind) {
            case SyntaxKind.PropertyAccessExpression:
                return (parent as PropertyAccessExpression).name !== node;
            case SyntaxKind.BindingElement:
                return (parent as BindingElement).propertyName !== node;
            default:
                return true;
        }
    }

    // Node helpers

    function functionExpressionToDeclaration(name: string | undefined, additionalModifiers: ReadonlyArray<Modifier>, fn: FunctionExpression | ArrowFunction | MethodDeclaration): FunctionDeclaration {
        return createFunctionDeclaration(
            getSynthesizedDeepClones(fn.decorators), // TODO: GH#19915 Don't think this is even legal.
            concatenate(additionalModifiers, getSynthesizedDeepClones(fn.modifiers)),
            getSynthesizedDeepClone(fn.asteriskToken),
            name,
            getSynthesizedDeepClones(fn.typeParameters),
            getSynthesizedDeepClones(fn.parameters),
            getSynthesizedDeepClone(fn.type),
            convertToFunctionBody(getSynthesizedDeepClone(fn.body)));
    }

    function classExpressionToDeclaration(name: string | undefined, additionalModifiers: ReadonlyArray<Modifier>, cls: ClassExpression): ClassDeclaration {
        return createClassDeclaration(
            getSynthesizedDeepClones(cls.decorators), // TODO: GH#19915 Don't think this is even legal.
            concatenate(additionalModifiers, getSynthesizedDeepClones(cls.modifiers)),
            name,
            getSynthesizedDeepClones(cls.typeParameters),
            getSynthesizedDeepClones(cls.heritageClauses),
            getSynthesizedDeepClones(cls.members));
    }

    function makeSingleImport(localName: string, propertyName: string, moduleSpecifier: string): ImportDeclaration {
        return propertyName === "default"
            ? makeImport(createIdentifier(localName), /*namedImports*/ undefined, moduleSpecifier)
            : makeImport(/*name*/ undefined, [makeImportSpecifier(propertyName, localName)], moduleSpecifier);
    }

    function makeImport(name: Identifier | undefined, namedImports: ReadonlyArray<ImportSpecifier>, moduleSpecifier: string): ImportDeclaration {
        const importClause = (name || namedImports) && createImportClause(name, namedImports && createNamedImports(namedImports));
        return createImportDeclaration(/*decorators*/ undefined, /*modifiers*/ undefined, importClause, createLiteral(moduleSpecifier));
    }

    function makeImportSpecifier(propertyName: string | undefined, name: string): ImportSpecifier {
        return createImportSpecifier(propertyName !== undefined && propertyName !== name ? createIdentifier(propertyName) : undefined, createIdentifier(name));
    }

    function makeConst(modifiers: ReadonlyArray<Modifier> | undefined, name: string | BindingName, init: Expression): VariableStatement {
        return createVariableStatement(
            modifiers,
            createVariableDeclarationList(
                [createVariableDeclaration(name, /*type*/ undefined, init)],
                NodeFlags.Const));
    }

    function makeExportDeclaration(exportSpecifiers: ExportSpecifier[] | undefined, moduleSpecifier?: string): ExportDeclaration {
        return createExportDeclaration(
            /*decorators*/ undefined,
            /*modifiers*/ undefined,
            exportSpecifiers && createNamedExports(exportSpecifiers),
            moduleSpecifier === undefined ? undefined : createLiteral(moduleSpecifier));
    }
}
