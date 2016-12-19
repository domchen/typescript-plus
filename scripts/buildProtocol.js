/// <reference types="node"/>
"use strict";
var ts = require("../lib/typescript");
var path = require("path");
function endsWith(s, suffix) {
    return s.lastIndexOf(suffix, s.length - suffix.length) !== -1;
}
var DeclarationsWalker = (function () {
    function DeclarationsWalker(typeChecker, protocolFile) {
        this.typeChecker = typeChecker;
        this.protocolFile = protocolFile;
        this.visitedTypes = [];
        this.text = "";
        this.removedTypes = [];
    }
    DeclarationsWalker.getExtraDeclarations = function (typeChecker, protocolFile) {
        var text = "declare namespace ts.server.protocol {\n";
        var walker = new DeclarationsWalker(typeChecker, protocolFile);
        walker.visitTypeNodes(protocolFile);
        text = walker.text
            ? "declare namespace ts.server.protocol {\n" + walker.text + "}"
            : "";
        if (walker.removedTypes) {
            text += "\ndeclare namespace ts {\n";
            text += "    // these types are empty stubs for types from services and should not be used directly\n";
            for (var _i = 0, _a = walker.removedTypes; _i < _a.length; _i++) {
                var type = _a[_i];
                text += "    export type " + type.symbol.name + " = never;\n";
            }
            text += "}";
        }
        return text;
    };
    DeclarationsWalker.prototype.processType = function (type) {
        if (this.visitedTypes.indexOf(type) >= 0) {
            return;
        }
        this.visitedTypes.push(type);
        var s = type.aliasSymbol || type.getSymbol();
        if (!s) {
            return;
        }
        if (s.name === "Array") {
            // we should process type argument instead
            return this.processType(type.typeArguments[0]);
        }
        else {
            for (var _i = 0, _a = s.getDeclarations(); _i < _a.length; _i++) {
                var decl = _a[_i];
                var sourceFile = decl.getSourceFile();
                if (sourceFile === this.protocolFile || path.basename(sourceFile.fileName) === "lib.d.ts") {
                    return;
                }
                if (decl.kind === ts.SyntaxKind.EnumDeclaration) {
                    this.removedTypes.push(type);
                    return;
                }
                else {
                    // splice declaration in final d.ts file
                    var text = decl.getFullText();
                    this.text += text + "\n";
                    // recursively pull all dependencies into result dts file
                    this.visitTypeNodes(decl);
                }
            }
        }
    };
    DeclarationsWalker.prototype.visitTypeNodes = function (node) {
        var _this = this;
        if (node.parent) {
            switch (node.parent.kind) {
                case ts.SyntaxKind.VariableDeclaration:
                case ts.SyntaxKind.MethodDeclaration:
                case ts.SyntaxKind.MethodSignature:
                case ts.SyntaxKind.PropertyDeclaration:
                case ts.SyntaxKind.PropertySignature:
                case ts.SyntaxKind.Parameter:
                case ts.SyntaxKind.IndexSignature:
                    if ((node.parent.type) === node) {
                        this.processTypeOfNode(node);
                    }
                    break;
                case ts.SyntaxKind.InterfaceDeclaration:
                    var heritageClauses = node.parent.heritageClauses;
                    if (heritageClauses) {
                        if (heritageClauses[0].token !== ts.SyntaxKind.ExtendsKeyword) {
                            throw new Error("Unexpected kind of heritage clause: " + ts.SyntaxKind[heritageClauses[0].kind]);
                        }
                        for (var _i = 0, _a = heritageClauses[0].types; _i < _a.length; _i++) {
                            var type = _a[_i];
                            this.processTypeOfNode(type);
                        }
                    }
                    break;
            }
        }
        ts.forEachChild(node, function (n) { return _this.visitTypeNodes(n); });
    };
    DeclarationsWalker.prototype.processTypeOfNode = function (node) {
        if (node.kind === ts.SyntaxKind.UnionType) {
            for (var _i = 0, _a = node.types; _i < _a.length; _i++) {
                var t = _a[_i];
                this.processTypeOfNode(t);
            }
        }
        else {
            var type = this.typeChecker.getTypeAtLocation(node);
            if (type && !(type.flags & (ts.TypeFlags.TypeParameter))) {
                this.processType(type);
            }
        }
    };
    return DeclarationsWalker;
}());
function generateProtocolFile(protocolTs, typeScriptServicesDts) {
    var options = { target: ts.ScriptTarget.ES5, declaration: true, noResolve: true, types: [], stripInternal: true };
    /**
     * 1st pass - generate a program from protocol.ts and typescriptservices.d.ts and emit core version of protocol.d.ts with all internal members stripped
     * @return text of protocol.d.t.s
     */
    function getInitialDtsFileForProtocol() {
        var program = ts.createProgram([protocolTs, typeScriptServicesDts], options);
        var protocolDts;
        program.emit(program.getSourceFile(protocolTs), function (file, content) {
            if (endsWith(file, ".d.ts")) {
                protocolDts = content;
            }
        });
        if (protocolDts === undefined) {
            throw new Error("Declaration file for protocol.ts is not generated");
        }
        return protocolDts;
    }
    var protocolFileName = "protocol.d.ts";
    /**
     * Second pass - generate a program from protocol.d.ts and typescriptservices.d.ts, then augment core protocol.d.ts with extra types from typescriptservices.d.ts
     */
    function getProgramWithProtocolText(protocolDts, includeTypeScriptServices) {
        var host = ts.createCompilerHost(options);
        var originalGetSourceFile = host.getSourceFile;
        host.getSourceFile = function (fileName) {
            if (fileName === protocolFileName) {
                return ts.createSourceFile(fileName, protocolDts, options.target);
            }
            return originalGetSourceFile.apply(host, [fileName]);
        };
        var rootFiles = includeTypeScriptServices ? [protocolFileName, typeScriptServicesDts] : [protocolFileName];
        return ts.createProgram(rootFiles, options, host);
    }
    var protocolDts = getInitialDtsFileForProtocol();
    var program = getProgramWithProtocolText(protocolDts, /*includeTypeScriptServices*/ true);
    var protocolFile = program.getSourceFile("protocol.d.ts");
    var extraDeclarations = DeclarationsWalker.getExtraDeclarations(program.getTypeChecker(), protocolFile);
    if (extraDeclarations) {
        protocolDts += extraDeclarations;
    }
    protocolDts += "\nimport protocol = ts.server.protocol;";
    protocolDts += "\nexport = protocol;";
    protocolDts += "\nexport as namespace protocol;";
    // do sanity check and try to compile generated text as standalone program
    var sanityCheckProgram = getProgramWithProtocolText(protocolDts, /*includeTypeScriptServices*/ false);
    var diagnostics = sanityCheckProgram.getSyntacticDiagnostics().concat(sanityCheckProgram.getSemanticDiagnostics(), sanityCheckProgram.getGlobalDiagnostics());
    if (diagnostics.length) {
        var flattenedDiagnostics = diagnostics.map(function (d) { return ts.flattenDiagnosticMessageText(d.messageText, "\n"); }).join("\n");
        throw new Error("Unexpected errors during sanity check: " + flattenedDiagnostics);
    }
    return protocolDts;
}
if (process.argv.length < 5) {
    console.log("Expected 3 arguments: path to 'protocol.ts', path to 'typescriptservices.d.ts' and path to output file");
    process.exit(1);
}
var protocolTs = process.argv[2];
var typeScriptServicesDts = process.argv[3];
var outputFile = process.argv[4];
var generatedProtocolDts = generateProtocolFile(protocolTs, typeScriptServicesDts);
ts.sys.writeFile(outputFile, generatedProtocolDts);
//# sourceMappingURL=file:////Users/dom/Documents/Program/HTML5/typescript-plus/scripts/buildProtocol.js.map