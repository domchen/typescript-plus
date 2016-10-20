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

namespace ts {

    let checker:TypeChecker;
    let sourceFiles:SourceFile[];
    let rootFileNames:string[];
    let dependencyMap:Map<string[]>;
    let pathWeightMap:Map<number>;

    export interface SortingResult {
        sortedFileNames:string[],
        circularReferences:string[]
    }

    export function reorderSourceFiles(program:Program):SortingResult {
        sourceFiles = program.getSourceFiles();
        rootFileNames = program.getRootFileNames();
        checker = program.getTypeChecker();
        buildDependencyMap();
        let result = sortOnDependency();
        sourceFiles = null;
        rootFileNames = null;
        checker = null;
        dependencyMap = null;
        return result;
    }


    function addDependency(file:string, dependent:string):void {
        if (file == dependent) {
            return;
        }
        let list = dependencyMap[file];
        if (!list) {
            list = dependencyMap[file] = [];
        }
        if (list.indexOf(dependent) == -1) {
            list.push(dependent);
        }
    }

    function buildDependencyMap():void {
        dependencyMap = createMap<string[]>();
        for (let i = 0; i < sourceFiles.length; i++) {
            let sourceFile = sourceFiles[i];
            if (sourceFile.isDeclarationFile) {
                continue;
            }
            visitFile(sourceFile);
        }
    }

    function visitFile(sourceFile:SourceFile):void {
        let hasDecorators = !!((sourceFile.flags & NodeFlags.HasDecorators) ||
        (sourceFile.flags & NodeFlags.HasParamDecorators));
        let statements = sourceFile.statements;
        let length = statements.length;
        for (let i = 0; i < length; i++) {
            let statement = statements[i];
            if (statement.flags & NodeFlags.Ambient) { // has the 'declare' keyword
                continue;
            }
            if (statement.kind === SyntaxKind.ExpressionStatement) {
                let expression = <ExpressionStatement>statement;
                checkExpression(expression.expression);
            }
            else if (statement.kind === SyntaxKind.ImportEqualsDeclaration) {
                let importDeclaration = <ImportEqualsDeclaration>statement;
                if (importDeclaration.moduleReference.kind == SyntaxKind.QualifiedName) {
                    let qualifiedName = <QualifiedName>importDeclaration.moduleReference;
                    checkDependencyAtLocation(qualifiedName);
                }
            }
            else {
                visitStatement(statements[i], hasDecorators);
            }
        }
    }

    function visitStatement(statement:Statement, hasDecorators?:boolean):void {
        switch (statement.kind) {
            case SyntaxKind.ClassDeclaration:
                checkInheriting(<ClassDeclaration>statement);
                checkStaticMember(<ClassDeclaration>statement);
                if (hasDecorators) {
                    checkClassDecorators(<ClassDeclaration>statement);
                }
                break;
            case SyntaxKind.VariableStatement:
                let variable = <VariableStatement>statement;
                variable.declarationList.declarations.forEach(declaration=> {
                    checkExpression(declaration.initializer);
                });
                break;
            case SyntaxKind.ModuleDeclaration:
                visitModule(<ModuleDeclaration>statement, hasDecorators);
                break;
        }
    }

    function visitModule(node:ModuleDeclaration, hasDecorators?:boolean):void {
        if (node.body.kind == SyntaxKind.ModuleDeclaration) {
            visitModule(<ModuleDeclaration>node.body);
            return;
        }
        let statements = (<ModuleBlock>node.body).statements;
        let length = statements.length;
        for (let i = 0; i < length; i++) {
            let statement = statements[i];
            if (statement.flags & NodeFlags.Ambient) { // has the 'declare' keyword
                continue;
            }
            visitStatement(statement, hasDecorators);
        }
    }

    function checkDependencyAtLocation(node:Node):void {
        let type = checker.getTypeAtLocation(node);
        if (!type || !type.symbol || type.flags & TypeFlags.Interface) {
            return;
        }
        let sourceFile = getSourceFileOfNode(type.symbol.valueDeclaration);
        if (!sourceFile ||sourceFile.isDeclarationFile) {
            return;
        }
        addDependency(getSourceFileOfNode(node).fileName, sourceFile.fileName);
    }

    function checkInheriting(node:ClassDeclaration):void {
        if (!node.heritageClauses) {
            return;
        }
        let heritageClause:HeritageClause = null;
        for (const clause of node.heritageClauses) {
            if (clause.token === SyntaxKind.ExtendsKeyword) {
                heritageClause = clause;
                break;
            }
        }
        if (!heritageClause) {
            return;
        }
        let superClasses = heritageClause.types;
        if (!superClasses) {
            return;
        }
        let currentFileName = getSourceFileOfNode(node).fileName;
        superClasses.forEach(superClass=> {
            checkDependencyAtLocation(superClass);
        });
    }

    function checkStaticMember(node:ClassDeclaration):void {
        let members = node.members;
        if (!members) {
            return;
        }
        for (let member of members) {
            if (!(member.flags & NodeFlags.Static)) {
                continue;
            }
            if (member.kind == SyntaxKind.PropertyDeclaration) {
                let property = <PropertyDeclaration>member;
                checkExpression(property.initializer);
            }
        }
    }

    function checkClassDecorators(node:ClassDeclaration):void {
        if (node.decorators) {
            checkDecorators(node.decorators);
        }
        let members = node.members;
        if (!members) {
            return;
        }
        for (let member of members) {
            let decorators:NodeArray<Decorator>;
            let functionLikeMember:FunctionLikeDeclaration;
            if (member.kind === SyntaxKind.GetAccessor || member.kind === SyntaxKind.SetAccessor) {
                const accessors = getAllAccessorDeclarations(node.members, <AccessorDeclaration>member);
                if (member !== accessors.firstAccessor) {
                    continue;
                }
                decorators = accessors.firstAccessor.decorators;
                if (!decorators && accessors.secondAccessor) {
                    decorators = accessors.secondAccessor.decorators;
                }
                functionLikeMember = accessors.setAccessor;
            }
            else {
                decorators = member.decorators;
                if (member.kind === SyntaxKind.MethodDeclaration) {
                    functionLikeMember = <MethodDeclaration>member;
                }
            }
            if (decorators) {
                checkDecorators(decorators);
            }

            if (functionLikeMember) {
                let parameterIndex = 0;
                for (const parameter of functionLikeMember.parameters) {
                    if (parameter.decorators) {
                        checkDecorators(parameter.decorators);
                    }
                }
            }
        }
    }

    function checkDecorators(decorators:NodeArray<Decorator>):void {
        for (let decorator of decorators) {
            checkExpression(decorator.expression);
        }
    }

    function checkExpression(expression:Expression):void {
        if (!expression) {
            return;
        }
        switch (expression.kind) {
            case SyntaxKind.NewExpression:
            case SyntaxKind.CallExpression:
                checkCallExpression(<CallExpression>expression);
                break;
            case SyntaxKind.Identifier:
            case SyntaxKind.PropertyAccessExpression:
                checkDependencyAtLocation(expression);
                break;
            case SyntaxKind.ArrayLiteralExpression:
                let arrayLiteral = <ArrayLiteralExpression>expression;
                arrayLiteral.elements.forEach(checkExpression);
                break;
            case SyntaxKind.TemplateExpression:
                let template = <TemplateExpression>expression;
                template.templateSpans.forEach(span=> {
                    checkExpression(span.expression);
                });
                break;
            case SyntaxKind.ParenthesizedExpression:
                let parenthesized = <ParenthesizedExpression>expression;
                checkExpression(parenthesized.expression);
                break;
            case SyntaxKind.BinaryExpression:
                let binary = <BinaryExpression>expression;
                checkExpression(binary.left);
                checkExpression(binary.right);
                break;
            case SyntaxKind.PostfixUnaryExpression:
            case SyntaxKind.PrefixUnaryExpression:
                checkExpression((<PrefixUnaryExpression>expression).operand);
                break;
            case SyntaxKind.DeleteExpression:
                checkExpression((<DeleteExpression>expression).expression);

        }

        // ObjectLiteralExpression
        // ElementAccessExpression
        // TaggedTemplateExpression
        // TypeAssertionExpression
        // FunctionExpression
        // ArrowFunction
        // TypeOfExpression
        // VoidExpression
        // AwaitExpression
        // ConditionalExpression
        // YieldExpression
        // SpreadElementExpression
        // ClassExpression
        // OmittedExpression
        // ExpressionWithTypeArguments
        // AsExpression
        // NonNullExpression
    }

    function checkCallExpression(callExpression:CallExpression):void {
        callExpression.arguments.forEach(argument=> {
            checkExpression(argument);
        });
        let expression = callExpression.expression;
        switch (expression.kind) {
            case SyntaxKind.FunctionExpression:
                let functionExpression = <FunctionExpression>expression;
                checkFunctionBody(functionExpression.body);
                break;
            case SyntaxKind.PropertyAccessExpression:
            case SyntaxKind.Identifier:
                let type = checker.getTypeAtLocation(expression);
                if (!type || !type.symbol || type.flags & TypeFlags.Interface) {
                    return;
                }
                let declaration = type.symbol.valueDeclaration;
                let sourceFile = getSourceFileOfNode(declaration);
                if (!sourceFile ||sourceFile.isDeclarationFile) {
                    return;
                }
                addDependency(getSourceFileOfNode(expression).fileName, sourceFile.fileName);
                if (declaration.kind === SyntaxKind.FunctionDeclaration ||
                    declaration.kind === SyntaxKind.MethodDeclaration) {
                    checkFunctionBody((<FunctionDeclaration>declaration).body);
                }
                else if (declaration.kind === SyntaxKind.ClassDeclaration) {
                    checkClassInstantiation(<ClassDeclaration>declaration);
                }
                break;
        }

    }

    function checkClassInstantiation(node:ClassDeclaration):void {
        let members = node.members;
        if (!members) {
            return;
        }
        for (let member of members) {
            if (member.flags & NodeFlags.Static) {
                continue;
            }
            if (member.kind === SyntaxKind.PropertyDeclaration) {
                let property = <PropertyDeclaration>member;
                checkExpression(property.initializer);
            }
            else if (member.kind === SyntaxKind.Constructor) {
                let constructor = <ConstructorDeclaration>member;
                checkFunctionBody(constructor.body);
            }
        }
    }

    function checkFunctionBody(body:FunctionBody):void {
        forEachChild(body, visit);
        function visit(node:Node) {
            if (node.kind === SyntaxKind.VariableStatement) {
                let variable = <VariableStatement>node;
                variable.declarationList.declarations.forEach(declaration=> {
                    checkExpression(declaration.initializer);
                });
            }
            else if (node.kind === SyntaxKind.ExpressionStatement) {
                let expression = <ExpressionStatement>node;
                checkExpression(expression.expression);
            }
            else {
                forEachChild(node, visit);
            }

        }
    }


    function sortOnDependency():SortingResult {
        let result:SortingResult = <any>{};
        result.sortedFileNames = [];
        result.circularReferences = [];
        pathWeightMap = createMap<number>();
        for (let i = 0; i < sourceFiles.length; i++) {
            let sourceFile = sourceFiles[i];
            if (sourceFile.isDeclarationFile) {
                continue;
            }
            let path = sourceFile.fileName;
            let references = updatePathWeight(path, 0, [path]);
            if (references) {
                result.circularReferences = references;
                break;
            }
        }
        if (result.circularReferences.length === 0) {
            sourceFiles.sort(function (a:SourceFile, b:SourceFile):number {
                return pathWeightMap[b.fileName] - pathWeightMap[a.fileName];
            });
            rootFileNames.length = 0;
            sourceFiles.forEach(sourceFile=> {
                rootFileNames.push(sourceFile.fileName);
                if (!sourceFile.isDeclarationFile) {
                    result.sortedFileNames.push(sourceFile.fileName);
                }
            });
        }
        pathWeightMap = null;
        return result;
    }

    function updatePathWeight(path:string, weight:number, references:string[]):string[] {
        if (pathWeightMap[path] === undefined) {
            pathWeightMap[path] = weight;
        }
        else {
            if (pathWeightMap[path] < weight) {
                pathWeightMap[path] = weight;
            }
            else {
                return null;
            }
        }
        let list = dependencyMap[path];
        if (!list) {
            return null;
        }
        for (let parentPath of list) {
            if (references.indexOf(parentPath) != -1) {
                references.push(parentPath);
                return references;
            }
            let result = updatePathWeight(parentPath, weight + 1, references.concat(parentPath));
            if (result) {
                return result;
            }
        }
        return null;
    }

    function getSourceFileOfNode(node:Node):SourceFile {
        while (node && node.kind !== SyntaxKind.SourceFile) {
            node = node.parent;
        }
        return <SourceFile>node;
    }
}
