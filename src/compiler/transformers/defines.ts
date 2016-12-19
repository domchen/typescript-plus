//////////////////////////////////////////////////////////////////////////////////////
//
//  The MIT License (MIT)
//
//  Copyright (c) 2015-present, Dom Chen.
//  All rights reserved.
//
//  Permission is hereby granted, free of charge, to any person obtaining a copy of
//  this software and associated documentation files (the "Software"), to deal in the
//  Software without restriction, including without limitation the rights to use, copy,
//  modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
//  and to permit persons to whom the Software is furnished to do so, subject to the
//  following conditions:
//
//      The above copyright notice and this permission notice shall be included in all
//      copies or substantial portions of the Software.
//
//  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//  PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
//  HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
//  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
//  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
//////////////////////////////////////////////////////////////////////////////////////

/*@internal*/
namespace ts {

    export function transformDefines(context:TransformationContext) {
        const resolver = context.getEmitResolver();
        const compilerOptions = context.getCompilerOptions();
        const compilerDefines = getCompilerDefines(compilerOptions.defines);
        const previousOnSubstituteNode = context.onSubstituteNode;
        if(compilerDefines){
            context.onSubstituteNode = onSubstituteNode;
            context.enableSubstitution(SyntaxKind.Identifier);
        }

        return transformSourceFile;

        function getCompilerDefines(defines:MapLike<any>):MapLike<string> {
            if (!defines) {
                return null;
            }
            let compilerDefines:MapLike<string> = {};
            let keys = Object.keys(defines);
            for (let key of keys) {
                let value = defines[key];
                let type = typeof value;
                switch (type) {
                    case "boolean":
                    case "number":
                        compilerDefines[key] = value.toString();
                        break;
                    case "string":
                        compilerDefines[key] = "\"" + value + "\"";
                        break;
                }
            }
            if (Object.keys(compilerDefines).length == 0) {
                return null;
            }
            return compilerDefines;
        }

        function isDefinedConstant(node:Identifier):boolean {
            if (compilerDefines[node.text] === undefined) {
                return false;
            }
            if (node.parent.kind === SyntaxKind.BinaryExpression) {
                let parent = <BinaryExpression>node.parent;
                if (parent.left === node && parent.operatorToken.kind === SyntaxKind.EqualsToken) {
                    return false;
                }
            }
            let declaration = resolver.getReferencedValueDeclaration(node);
            if (!declaration) {
                return false;
            }
            if (declaration.kind !== SyntaxKind.VariableDeclaration) {
                return false;
            }
            let statement = declaration.parent.parent;
            return (statement.parent.kind === SyntaxKind.SourceFile);
        }

        /**
         * Hooks node substitutions.
         * @param emitContext The context for the emitter.
         * @param node The node to substitute.
         */
        function onSubstituteNode(emitContext:EmitContext, node:Node) {
            node = previousOnSubstituteNode(emitContext, node);
            if (isIdentifier(node) && isDefinedConstant(node)) {
                return createIdentifier(compilerDefines[node.text]);
            }
            return node;
        }

        function transformSourceFile(node:SourceFile) {
            return node;
        }
    }
}
