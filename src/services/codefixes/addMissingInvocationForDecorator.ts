/* @internal */
namespace ts.codefix {
    const fixId = "addMissingInvocationForDecorator";
    const errorCodes = [Diagnostics._0_accepts_too_few_arguments_to_be_used_as_a_decorator_here_Did_you_mean_to_call_it_first_and_write_0.code];
    registerCodeFix({
        errorCodes,
        getCodeActions: (context) => {
            const changes = textChanges.ChangeTracker.with(context, t => makeChange(t, context.sourceFile, context.span.start));
            return [{ description: getLocaleSpecificMessage(Diagnostics.Call_decorator_expression), changes, fixId }];
        },
        fixIds: [fixId],
        getAllCodeActions: context => codeFixAll(context, errorCodes, (changes, diag) => makeChange(changes, diag.file!, diag.start!)),
    });

    function makeChange(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, pos: number) {
        const token = getTokenAtPosition(sourceFile, pos, /*includeJsDocComment*/ false);
        const decorator = findAncestor(token, isDecorator)!;
        Debug.assert(!!decorator, "Expected position to be owned by a decorator.");
        const replacement = createCall(decorator.expression, /*typeArguments*/ undefined, /*argumentsArray*/ undefined);
        changeTracker.replaceNode(sourceFile, decorator.expression, replacement);
    }
}
