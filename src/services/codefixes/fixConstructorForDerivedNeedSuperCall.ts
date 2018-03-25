/* @internal */
namespace ts.codefix {
    const fixId = "constructorForDerivedNeedSuperCall";
    const errorCodes = [Diagnostics.Constructors_for_derived_classes_must_contain_a_super_call.code];
    registerCodeFix({
        errorCodes,
        getCodeActions(context) {
            const { sourceFile, span } = context;
            const ctr = getNode(sourceFile, span.start);
            const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, ctr));
            return [{ description: getLocaleSpecificMessage(Diagnostics.Add_missing_super_call), changes, fixId }];
        },
        fixIds: [fixId],
        getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) =>
            doChange(changes, context.sourceFile, getNode(diag.file, diag.start!))),
    });

    function getNode(sourceFile: SourceFile, pos: number): ConstructorDeclaration {
        const token = getTokenAtPosition(sourceFile, pos, /*includeJsDocComment*/ false);
        Debug.assert(token.kind === SyntaxKind.ConstructorKeyword);
        return token.parent as ConstructorDeclaration;
    }

    function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, ctr: ConstructorDeclaration) {
        const superCall = createStatement(createCall(createSuper(), /*typeArguments*/ undefined, /*argumentsArray*/ emptyArray));
        changes.insertNodeAtConstructorStart(sourceFile, ctr, superCall);
    }
}
