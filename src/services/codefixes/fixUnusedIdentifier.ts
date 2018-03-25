/* @internal */
namespace ts.codefix {
    const fixIdPrefix = "unusedIdentifier_prefix";
    const fixIdDelete = "unusedIdentifier_delete";
    const errorCodes = [
        Diagnostics._0_is_declared_but_its_value_is_never_read.code,
        Diagnostics.Property_0_is_declared_but_its_value_is_never_read.code,
    ];
    registerCodeFix({
        errorCodes,
        getCodeActions(context) {
            const { sourceFile } = context;
            const token = getToken(sourceFile, context.span.start);
            const result: CodeFixAction[] = [];

            const deletion = textChanges.ChangeTracker.with(context, t => tryDeleteDeclaration(t, sourceFile, token));
            if (deletion.length) {
                const description = formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Remove_declaration_for_Colon_0), [token.getText()]);
                result.push({ description, changes: deletion, fixId: fixIdDelete });
            }

            const prefix = textChanges.ChangeTracker.with(context, t => tryPrefixDeclaration(t, context.errorCode, sourceFile, token));
            if (prefix.length) {
                const description = formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Prefix_0_with_an_underscore), [token.getText()]);
                result.push({ description, changes: prefix, fixId: fixIdPrefix });
            }

            return result;
        },
        fixIds: [fixIdPrefix, fixIdDelete],
        getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => {
            const { sourceFile } = context;
            const token = getToken(diag.file!, diag.start!);
            switch (context.fixId) {
                case fixIdPrefix:
                    if (isIdentifier(token) && canPrefix(token)) {
                        tryPrefixDeclaration(changes, diag.code, sourceFile, token);
                    }
                    break;
                case fixIdDelete:
                    tryDeleteDeclaration(changes, sourceFile, token);
                    break;
                default:
                    Debug.fail(JSON.stringify(context.fixId));
            }
        }),
    });

    function getToken(sourceFile: SourceFile, pos: number): Node {
        const token = getTokenAtPosition(sourceFile, pos, /*includeJsDocComment*/ false);
        // this handles var ["computed"] = 12;
        return token.kind === SyntaxKind.OpenBracketToken ? getTokenAtPosition(sourceFile, pos + 1, /*includeJsDocComment*/ false) : token;
    }

    function tryPrefixDeclaration(changes: textChanges.ChangeTracker, errorCode: number, sourceFile: SourceFile, token: Node): void {
        // Don't offer to prefix a property.
        if (errorCode !== Diagnostics.Property_0_is_declared_but_its_value_is_never_read.code && isIdentifier(token) && canPrefix(token)) {
            changes.replaceNode(sourceFile, token, createIdentifier(`_${token.text}`));
        }
    }

    function canPrefix(token: Identifier): boolean {
        switch (token.parent.kind) {
            case SyntaxKind.Parameter:
                return true;
            case SyntaxKind.VariableDeclaration: {
                const varDecl = token.parent as VariableDeclaration;
                switch (varDecl.parent.parent.kind) {
                    case SyntaxKind.ForOfStatement:
                    case SyntaxKind.ForInStatement:
                        return true;
                }
            }
        }
        return false;
    }

    function tryDeleteDeclaration(changes: textChanges.ChangeTracker, sourceFile: SourceFile, token: Node): void {
        switch (token.kind) {
            case SyntaxKind.Identifier:
                tryDeleteIdentifier(changes, sourceFile, <Identifier>token);
                break;
            case SyntaxKind.PropertyDeclaration:
            case SyntaxKind.NamespaceImport:
                changes.deleteNode(sourceFile, token.parent);
                break;
            default:
                tryDeleteDefault(changes, sourceFile, token);
        }
    }

    function tryDeleteDefault(changes: textChanges.ChangeTracker, sourceFile: SourceFile, token: Node): void {
        if (isDeclarationName(token)) {
            changes.deleteNode(sourceFile, token.parent);
        }
        else if (isLiteralComputedPropertyDeclarationName(token)) {
            changes.deleteNode(sourceFile, token.parent.parent);
        }
    }

    function tryDeleteIdentifier(changes: textChanges.ChangeTracker, sourceFile: SourceFile, identifier: Identifier): void {
        const parent = identifier.parent;
        switch (parent.kind) {
            case SyntaxKind.VariableDeclaration:
                tryDeleteVariableDeclaration(changes, sourceFile, <VariableDeclaration>parent);
                break;

            case SyntaxKind.TypeParameter:
                const typeParameters = (<DeclarationWithTypeParameters>parent.parent).typeParameters;
                if (typeParameters.length === 1) {
                    const previousToken = getTokenAtPosition(sourceFile, typeParameters.pos - 1, /*includeJsDocComment*/ false);
                    const nextToken = getTokenAtPosition(sourceFile, typeParameters.end, /*includeJsDocComment*/ false);
                    Debug.assert(previousToken.kind === SyntaxKind.LessThanToken);
                    Debug.assert(nextToken.kind === SyntaxKind.GreaterThanToken);

                    changes.deleteNodeRange(sourceFile, previousToken, nextToken);
                }
                else {
                    changes.deleteNodeInList(sourceFile, parent);
                }
                break;

            case SyntaxKind.Parameter:
                const oldFunction = parent.parent;
                if (isArrowFunction(oldFunction) && oldFunction.parameters.length === 1) {
                    // Lambdas with exactly one parameter are special because, after removal, there
                    // must be an empty parameter list (i.e. `()`) and this won't necessarily be the
                    // case if the parameter is simply removed (e.g. in `x => 1`).
                    const newFunction = updateArrowFunction(
                        oldFunction,
                        oldFunction.modifiers,
                        oldFunction.typeParameters,
                        /*parameters*/ undefined,
                        oldFunction.type,
                        oldFunction.equalsGreaterThanToken,
                        oldFunction.body);

                    // Drop leading and trailing trivia of the new function because we're only going
                    // to replace the span (vs the full span) of the old function - the old leading
                    // and trailing trivia will remain.
                    suppressLeadingAndTrailingTrivia(newFunction);

                    changes.replaceRange(sourceFile, { pos: oldFunction.getStart(), end: oldFunction.end }, newFunction);
                }
                else {
                    changes.deleteNodeInList(sourceFile, parent);
                }
                break;

            // handle case where 'import a = A;'
            case SyntaxKind.ImportEqualsDeclaration:
                const importEquals = getAncestor(identifier, SyntaxKind.ImportEqualsDeclaration);
                changes.deleteNode(sourceFile, importEquals);
                break;

            case SyntaxKind.ImportSpecifier:
                const namedImports = <NamedImports>parent.parent;
                if (namedImports.elements.length === 1) {
                    tryDeleteNamedImportBinding(changes, sourceFile, namedImports);
                }
                else {
                    // delete import specifier
                    changes.deleteNodeInList(sourceFile, parent);
                }
                break;

            case SyntaxKind.ImportClause: // this covers both 'import |d|' and 'import |d,| *'
                const importClause = <ImportClause>parent;
                if (!importClause.namedBindings) { // |import d from './file'|
                    changes.deleteNode(sourceFile, getAncestor(importClause, SyntaxKind.ImportDeclaration)!);
                }
                else {
                    // import |d,| * as ns from './file'
                    const start = importClause.name.getStart(sourceFile);
                    const nextToken = getTokenAtPosition(sourceFile, importClause.name.end, /*includeJsDocComment*/ false);
                    if (nextToken && nextToken.kind === SyntaxKind.CommaToken) {
                        // shift first non-whitespace position after comma to the start position of the node
                        const end = skipTrivia(sourceFile.text, nextToken.end, /*stopAfterLineBreaks*/ false, /*stopAtComments*/ true);
                        changes.deleteRange(sourceFile, { pos: start, end });
                    }
                    else {
                        changes.deleteNode(sourceFile, importClause.name);
                    }
                }
                break;

            case SyntaxKind.NamespaceImport:
                tryDeleteNamedImportBinding(changes, sourceFile, <NamespaceImport>parent);
                break;

            default:
                tryDeleteDefault(changes, sourceFile, identifier);
                break;
        }
    }

    function tryDeleteNamedImportBinding(changes: textChanges.ChangeTracker, sourceFile: SourceFile, namedBindings: NamedImportBindings): void {
        if ((<ImportClause>namedBindings.parent).name) {
            // Delete named imports while preserving the default import
            // import d|, * as ns| from './file'
            // import d|, { a }| from './file'
            const previousToken = getTokenAtPosition(sourceFile, namedBindings.pos - 1, /*includeJsDocComment*/ false);
            if (previousToken && previousToken.kind === SyntaxKind.CommaToken) {
                changes.deleteRange(sourceFile, { pos: previousToken.getStart(), end: namedBindings.end });
            }
        }
        else {
            // Delete the entire import declaration
            // |import * as ns from './file'|
            // |import { a } from './file'|
            const importDecl = getAncestor(namedBindings, SyntaxKind.ImportDeclaration);
            changes.deleteNode(sourceFile, importDecl);
        }
    }

    // token.parent is a variableDeclaration
    function tryDeleteVariableDeclaration(changes: textChanges.ChangeTracker, sourceFile: SourceFile, varDecl: VariableDeclaration): void {
        switch (varDecl.parent.parent.kind) {
            case SyntaxKind.ForStatement: {
                const forStatement = varDecl.parent.parent;
                const forInitializer = <VariableDeclarationList>forStatement.initializer;
                if (forInitializer.declarations.length === 1) {
                    changes.deleteNode(sourceFile, forInitializer);
                }
                else {
                    changes.deleteNodeInList(sourceFile, varDecl);
                }
                break;
            }

            case SyntaxKind.ForOfStatement:
                const forOfStatement = <ForOfStatement>varDecl.parent.parent;
                Debug.assert(forOfStatement.initializer.kind === SyntaxKind.VariableDeclarationList);
                const forOfInitializer = <VariableDeclarationList>forOfStatement.initializer;
                changes.replaceNode(sourceFile, forOfInitializer.declarations[0], createObjectLiteral());
                break;

            case SyntaxKind.ForInStatement:
            case SyntaxKind.TryStatement:
                break;

            default:
                const variableStatement = <VariableStatement>varDecl.parent.parent;
                if (variableStatement.declarationList.declarations.length === 1) {
                    changes.deleteNode(sourceFile, variableStatement);
                }
                else {
                    changes.deleteNodeInList(sourceFile, varDecl);
                }
        }
    }
}