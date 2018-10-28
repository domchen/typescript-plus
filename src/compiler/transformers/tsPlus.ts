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

    export function transformTypeScriptPlus(context: TransformationContext) {
        const compilerOptions = context.getCompilerOptions();
        const compilerDefines = getCompilerDefines(compilerOptions.defines!);
        const typeChecker = compilerOptions.emitReflection || compilerDefines ? context.getEmitHost().getTypeChecker() : null;
        const previousOnSubstituteNode = context.onSubstituteNode;
        if (compilerDefines) {
            context.onSubstituteNode = onSubstituteNode;
            context.enableSubstitution(SyntaxKind.Identifier);
        }

        return chainBundle(transformSourceFile);

        function transformSourceFile(node: SourceFile) {
            if (!compilerOptions.emitReflection) {
                return node;
            }
            let visited = updateSourceFileNode(node, visitNodes(node.statements, visitStatement, isStatement));
            addEmitHelpers(visited, context.readEmitHelpers());
            return visited;
        }

        function visitStatement(node: Node): VisitResult<Node> {
            if (hasModifier(node, ModifierFlags.Ambient)) {
                return node;
            }
            if (node.kind === SyntaxKind.ClassDeclaration) {
                return visitClassDeclaration(<ClassDeclaration>node);
            }
            if (node.kind === SyntaxKind.ModuleDeclaration) {
                return visitModule(<NamespaceDeclaration>node);
            }
            return node;
        }

        function visitModule(node: NamespaceDeclaration): NamespaceDeclaration {
            if (node.body.kind === SyntaxKind.ModuleDeclaration) {
                return updateModuleDeclaration(node, visitModule(<NamespaceDeclaration>node.body));
            }
            if (node.body.kind === SyntaxKind.ModuleBlock) {
                const body = updateModuleBlock(node.body, visitNodes(
                    (<ModuleBlock>node.body).statements, visitStatement, isStatement));
                return updateModuleDeclaration(node, body);
            }
            return node;
        }

        function updateModuleDeclaration(node: NamespaceDeclaration, body: ModuleBody) {
            if (node.body !== body) {
                let updated = getMutableClone(node);
                updated.body = <ModuleBlock>body;
                return updateNode(updated, node);
            }
            return node
        }

        function updateModuleBlock(node: ModuleBlock, statements: NodeArray<Statement>) {
            if (node.statements !== statements) {
                let updated = getMutableClone(node);
                updated.statements = createNodeArray(statements);
                return updateNode(updated, node);
            }
            return node;
        }

        function visitClassDeclaration(node: ClassDeclaration): VisitResult<Statement> {
            const classStatement = getMutableClone(node);
            const statements: Statement[] = [classStatement];

            let interfaceMap: any = {};
            getImplementedInterfaces(node, interfaceMap);
            let allInterfaces: string[] = Object.keys(interfaceMap);
            let interfaces: string[];
            let superTypes = getSuperClassTypes(node);
            if (superTypes) {
                interfaces = [];
                for (let type of allInterfaces) {
                    if (superTypes.indexOf(type) === -1) {
                        interfaces.push(type);
                    }
                }
            }
            else {
                interfaces = allInterfaces;
            }
            node.typeNames = interfaces;
            let fullClassName = typeChecker!.getFullyQualifiedName(node.symbol);
            const expression = createReflectHelper(context, node.name!, fullClassName, interfaces);
            setSourceMapRange(expression, createRange(node.name!.pos, node.end));

            const statement = createStatement(expression);
            setSourceMapRange(statement, createRange(-1, node.end));
            statements.push(statement);

            return statements;
        }

        function getImplementedInterfaces(node: Node, result: any) {
            let superInterfaces: NodeArray<any> | undefined = undefined;
            if (node.kind === SyntaxKind.ClassDeclaration) {
                superInterfaces = getClassImplementsHeritageClauseElements(<ClassLikeDeclaration>node);
            }
            else {
                superInterfaces = getInterfaceBaseTypeNodes(<InterfaceDeclaration>node);
            }
            if (superInterfaces) {
                superInterfaces.forEach(superInterface => {
                    let type = typeChecker!.getTypeAtLocation(superInterface)
                    if (type && type.symbol && type.symbol.flags & SymbolFlags.Interface) {
                        let symbol = type.symbol;
                        let fullName = typeChecker!.getFullyQualifiedName(symbol);
                        result[fullName] = true;
                        const declaration = ts.getDeclarationOfKind(symbol, SyntaxKind.InterfaceDeclaration);
                        if (declaration) {
                            getImplementedInterfaces(declaration, result);
                        }
                    }
                });
            }
        }

        function getSuperClassTypes(node: ClassLikeDeclaration): string[] | undefined {
            let superClass = getClassExtendsHeritageElement(node);
            if (!superClass) {
                return undefined;
            }
            let type = typeChecker!.getTypeAtLocation(superClass);
            if (!type || !type.symbol) {
                return undefined;
            }
            let declaration = <ClassLikeDeclaration>ts.getDeclarationOfKind(type.symbol, SyntaxKind.ClassDeclaration);
            return declaration ? declaration.typeNames : undefined;
        }


        function getCompilerDefines(defines: MapLike<any>): MapLike<string> | null {
            if (!defines) {
                return null;
            }
            let compilerDefines: MapLike<string> = {};
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

        function isDefinedConstant(node: Identifier): boolean {
            let nodeText = ts.getTextOfIdentifierOrLiteral(node);
            if (compilerDefines![nodeText] === undefined) {
                return false;
            }
            if (!node.parent) {
                return false
            }
            if (node.parent.kind === SyntaxKind.VariableDeclaration && (<VariableDeclaration>node.parent).name === node) {
                return false;
            }
            if (node.parent.kind === SyntaxKind.BinaryExpression) {
                let parent = <BinaryExpression>node.parent;
                if (parent.left === node && parent.operatorToken.kind === SyntaxKind.EqualsToken) {
                    return false;
                }
            }

            let symbol = typeChecker!.getSymbolAtLocation(node);
            if (!symbol || !symbol.declarations) {
                return false;
            }
            let declaration = symbol.declarations[0];
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
        function onSubstituteNode(hint: EmitHint, node: Node) {
            node = previousOnSubstituteNode(hint, node);
            if (isIdentifier(node) && isDefinedConstant(node)) {
                let nodeText = ts.getTextOfIdentifierOrLiteral(node);
                return createIdentifier(compilerDefines![nodeText]);
            }
            return node;
        }
    }

    const reflectHelper: EmitHelper = {
        name: "typescript:reflect",
        scoped: false,
        priority: 0,
        text: `
            var __reflect = (this && this.__reflect) || function (p, c, t) {
                p.__class__ = c, t ? t.push(c) : t = [c], p.__types__ = p.__types__ ? t.concat(p.__types__) : t;
            };`
    };

    function createReflectHelper(context: TransformationContext, name: Identifier, fullClassName: string, interfaces: string[]) {
        context.requestEmitHelper(reflectHelper);
        let argumentsArray: Expression[] = [
            createPropertyAccess(name, createIdentifier("prototype")),
            createLiteral(fullClassName)
        ];
        if (interfaces.length) {
            let elements: Expression[] = [];
            for (let value of interfaces) {
                elements.push(createLiteral(value));
            }
            argumentsArray.push(createArrayLiteral(elements));
        }
        return createCall(
            getHelperName("__reflect"),
            /*typeArguments*/ undefined,
            argumentsArray
        );
    }
}
