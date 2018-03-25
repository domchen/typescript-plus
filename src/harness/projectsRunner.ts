///<reference path="harness.ts" />
///<reference path="runnerbase.ts" />

// Test case is json of below type in tests/cases/project/
interface ProjectRunnerTestCase {
    scenario: string;
    projectRoot: string; // project where it lives - this also is the current directory when compiling
    inputFiles: ReadonlyArray<string>; // list of input files to be given to program
    resolveMapRoot?: boolean; // should we resolve this map root and give compiler the absolute disk path as map root?
    resolveSourceRoot?: boolean; // should we resolve this source root and give compiler the absolute disk path as map root?
    baselineCheck?: boolean; // Verify the baselines of output files, if this is false, we will write to output to the disk but there is no verification of baselines
    runTest?: boolean; // Run the resulting test
    bug?: string; // If there is any bug associated with this test case
}

interface ProjectRunnerTestCaseResolutionInfo extends ProjectRunnerTestCase {
    // Apart from actual test case the results of the resolution
    resolvedInputFiles: ReadonlyArray<string>; // List of files that were asked to read by compiler
    emittedFiles: ReadonlyArray<string>; // List of files that were emitted by the compiler
}

interface BatchCompileProjectTestCaseEmittedFile extends Harness.Compiler.GeneratedFile {
    emittedFileName: string;
}

interface CompileProjectFilesResult {
    configFileSourceFiles: ReadonlyArray<ts.SourceFile>;
    moduleKind: ts.ModuleKind;
    program?: ts.Program;
    compilerOptions?: ts.CompilerOptions;
    errors: ReadonlyArray<ts.Diagnostic>;
    sourceMapData?: ReadonlyArray<ts.SourceMapData>;
}

interface BatchCompileProjectTestCaseResult extends CompileProjectFilesResult {
    outputFiles?: BatchCompileProjectTestCaseEmittedFile[];
}

class ProjectRunner extends RunnerBase {

    public enumerateTestFiles() {
        return this.enumerateFiles("tests/cases/project", /\.json$/, { recursive: true });
    }

    public kind(): TestRunnerKind {
        return "project";
    }

    public initializeTests() {
        if (this.tests.length === 0) {
            const testFiles = this.enumerateTestFiles();
            testFiles.forEach(fn => {
                this.runProjectTestCase(fn);
            });
        }
        else {
            this.tests.forEach(test => this.runProjectTestCase(test));
        }
    }

    private runProjectTestCase(testCaseFileName: string) {
        let testCase: ProjectRunnerTestCase & ts.CompilerOptions;

        let testFileText: string;
        try {
            testFileText = Harness.IO.readFile(testCaseFileName);
        }
        catch (e) {
            assert(false, "Unable to open testcase file: " + testCaseFileName + ": " + e.message);
        }

        try {
            testCase = <ProjectRunnerTestCase & ts.CompilerOptions>JSON.parse(testFileText);
        }
        catch (e) {
            assert(false, "Testcase: " + testCaseFileName + " does not contain valid json format: " + e.message);
        }
        let testCaseJustName = testCaseFileName.replace(/^.*[\\\/]/, "").replace(/\.json/, "");

        function moduleNameToString(moduleKind: ts.ModuleKind) {
            return moduleKind === ts.ModuleKind.AMD
                ? "amd"
                : moduleKind === ts.ModuleKind.CommonJS
                ? "node"
                : "none";
        }

        // Project baselines verified go in project/testCaseName/moduleKind/
        function getBaselineFolder(moduleKind: ts.ModuleKind) {
            return "project/" + testCaseJustName + "/" + moduleNameToString(moduleKind) + "/";
        }

        // When test case output goes to tests/baselines/local/projectOutput/testCaseName/moduleKind/
        // We have these two separate locations because when comparing baselines the baseline verifier will delete the existing file
        // so even if it was created by compiler in that location, the file will be deleted by verified before we can read it
        // so lets keep these two locations separate
        function getProjectOutputFolder(fileName: string, moduleKind: ts.ModuleKind) {
            return Harness.Baseline.localPath("projectOutput/" + testCaseJustName + "/" + moduleNameToString(moduleKind) + "/" + fileName);
        }

        function cleanProjectUrl(url: string) {
            let diskProjectPath = ts.normalizeSlashes(Harness.IO.resolvePath(testCase.projectRoot));
            let projectRootUrl = "file:///" + diskProjectPath;
            const normalizedProjectRoot = ts.normalizeSlashes(testCase.projectRoot);
            diskProjectPath = diskProjectPath.substr(0, diskProjectPath.lastIndexOf(normalizedProjectRoot));
            projectRootUrl = projectRootUrl.substr(0, projectRootUrl.lastIndexOf(normalizedProjectRoot));
            if (url && url.length) {
                if (url.indexOf(projectRootUrl) === 0) {
                    // replace the disk specific project url path into project root url
                    url = "file:///" + url.substr(projectRootUrl.length);
                }
                else if (url.indexOf(diskProjectPath) === 0) {
                    // Replace the disk specific path into the project root path
                    url = url.substr(diskProjectPath.length);
                    if (url.charCodeAt(0) !== ts.CharacterCodes.slash) {
                        url = "/" + url;
                    }
                }
            }

            return url;
        }

        function getCurrentDirectory() {
            return Harness.IO.resolvePath(testCase.projectRoot);
        }

        function compileProjectFiles(moduleKind: ts.ModuleKind, configFileSourceFiles: ReadonlyArray<ts.SourceFile>,
            getInputFiles: () => ReadonlyArray<string>,
            getSourceFileTextImpl: (fileName: string) => string,
            writeFile: (fileName: string, data: string, writeByteOrderMark: boolean) => void,
            compilerOptions: ts.CompilerOptions): CompileProjectFilesResult {

            const program = ts.createProgram(getInputFiles(), compilerOptions, createCompilerHost());
            const errors = ts.getPreEmitDiagnostics(program);

            const emitResult = program.emit();
            ts.addRange(errors, emitResult.diagnostics);
            const sourceMapData = emitResult.sourceMaps;

            // Clean up source map data that will be used in baselining
            if (sourceMapData) {
                for (const data of sourceMapData) {
                    for (let j = 0; j < data.sourceMapSources.length; j++) {
                        data.sourceMapSources[j] = cleanProjectUrl(data.sourceMapSources[j]);
                    }
                    data.jsSourceMappingURL = cleanProjectUrl(data.jsSourceMappingURL);
                    data.sourceMapSourceRoot = cleanProjectUrl(data.sourceMapSourceRoot);
                }
            }

            return {
                configFileSourceFiles,
                moduleKind,
                program,
                errors,
                sourceMapData
            };

            function getSourceFileText(fileName: string): string {
                const text = getSourceFileTextImpl(fileName);
                return text !== undefined ? text : getSourceFileTextImpl(ts.getNormalizedAbsolutePath(fileName, getCurrentDirectory()));
            }

            function getSourceFile(fileName: string, languageVersion: ts.ScriptTarget): ts.SourceFile {
                let sourceFile: ts.SourceFile = undefined;
                if (fileName === Harness.Compiler.defaultLibFileName) {
                    sourceFile = Harness.Compiler.getDefaultLibrarySourceFile(Harness.Compiler.getDefaultLibFileName(compilerOptions));
                }
                else {
                    const text = getSourceFileText(fileName);
                    if (text !== undefined) {
                        sourceFile = Harness.Compiler.createSourceFileAndAssertInvariants(fileName, text, languageVersion);
                    }
                }

                return sourceFile;
            }

            function createCompilerHost(): ts.CompilerHost {
                return {
                    getSourceFile,
                    getDefaultLibFileName: () => Harness.Compiler.defaultLibFileName,
                    writeFile,
                    getCurrentDirectory,
                    getCanonicalFileName: Harness.Compiler.getCanonicalFileName,
                    useCaseSensitiveFileNames: () => Harness.IO.useCaseSensitiveFileNames(),
                    getNewLine: () => Harness.IO.newLine(),
                    fileExists: fileName => fileName === Harness.Compiler.defaultLibFileName || getSourceFileText(fileName) !== undefined,
                    readFile: fileName => Harness.IO.readFile(fileName),
                    getDirectories: path => Harness.IO.getDirectories(path)
                };
            }
        }

        function batchCompilerProjectTestCase(moduleKind: ts.ModuleKind): BatchCompileProjectTestCaseResult {
            let nonSubfolderDiskFiles = 0;

            const outputFiles: BatchCompileProjectTestCaseEmittedFile[] = [];
            let inputFiles = testCase.inputFiles;
            let compilerOptions = createCompilerOptions();
            const configFileSourceFiles: ts.SourceFile[] = [];

            let configFileName: string;
            if (compilerOptions.project) {
                // Parse project
                configFileName = ts.normalizePath(ts.combinePaths(compilerOptions.project, "tsconfig.json"));
                assert(!inputFiles || inputFiles.length === 0, "cannot specify input files and project option together");
            }
            else if (!inputFiles || inputFiles.length === 0) {
                configFileName = ts.findConfigFile("", fileExists);
            }

            let errors: ts.Diagnostic[];
            if (configFileName) {
                const result = ts.readJsonConfigFile(configFileName, getSourceFileText);
                configFileSourceFiles.push(result);
                const configParseHost: ts.ParseConfigHost = {
                    useCaseSensitiveFileNames: Harness.IO.useCaseSensitiveFileNames(),
                    fileExists,
                    readDirectory,
                    readFile
                };
                const configParseResult = ts.parseJsonSourceFileConfigFileContent(result, configParseHost, ts.getDirectoryPath(configFileName), compilerOptions);
                inputFiles = configParseResult.fileNames;
                compilerOptions = configParseResult.options;
                errors = result.parseDiagnostics.concat(configParseResult.errors);
            }

            const projectCompilerResult = compileProjectFiles(moduleKind, configFileSourceFiles, () => inputFiles, getSourceFileText, writeFile, compilerOptions);
            return {
                configFileSourceFiles,
                moduleKind,
                program: projectCompilerResult.program,
                compilerOptions,
                sourceMapData: projectCompilerResult.sourceMapData,
                outputFiles,
                errors: errors ? ts.concatenate(errors, projectCompilerResult.errors) : projectCompilerResult.errors,
            };

            function createCompilerOptions() {
                // Set the special options that depend on other testcase options
                const compilerOptions: ts.CompilerOptions = {
                    mapRoot: testCase.resolveMapRoot && testCase.mapRoot ? Harness.IO.resolvePath(testCase.mapRoot) : testCase.mapRoot,
                    sourceRoot: testCase.resolveSourceRoot && testCase.sourceRoot ? Harness.IO.resolvePath(testCase.sourceRoot) : testCase.sourceRoot,
                    module: moduleKind,
                    moduleResolution: ts.ModuleResolutionKind.Classic, // currently all tests use classic module resolution kind, this will change in the future
                };
                // Set the values specified using json
                const optionNameMap = ts.arrayToMap(ts.optionDeclarations, option => option.name);
                for (const name in testCase) {
                    if (name !== "mapRoot" && name !== "sourceRoot") {
                        const option = optionNameMap.get(name);
                        if (option) {
                            const optType = option.type;
                            let value = <any>testCase[name];
                            if (!ts.isString(optType)) {
                                const key = value.toLowerCase();
                                const optTypeValue = optType.get(key);
                                if (optTypeValue) {
                                    value = optTypeValue;
                                }
                            }
                            compilerOptions[option.name] = value;
                        }
                    }
                }

                return compilerOptions;
            }

            function getFileNameInTheProjectTest(fileName: string): string {
                return ts.isRootedDiskPath(fileName)
                    ? fileName
                    : ts.normalizeSlashes(testCase.projectRoot) + "/" + ts.normalizeSlashes(fileName);
            }

            function readDirectory(rootDir: string, extension: string[], exclude: string[], include: string[], depth: number): string[] {
                const harnessReadDirectoryResult = Harness.IO.readDirectory(getFileNameInTheProjectTest(rootDir), extension, exclude, include, depth);
                const result: string[] = [];
                for (let i = 0; i < harnessReadDirectoryResult.length; i++) {
                    result[i] = ts.getRelativePathToDirectoryOrUrl(testCase.projectRoot, harnessReadDirectoryResult[i],
                        getCurrentDirectory(), Harness.Compiler.getCanonicalFileName, /*isAbsolutePathAnUrl*/ false);
                }
                return result;
            }

            function fileExists(fileName: string): boolean {
                return Harness.IO.fileExists(getFileNameInTheProjectTest(fileName));
            }

            function readFile(fileName: string): string | undefined {
                return Harness.IO.readFile(getFileNameInTheProjectTest(fileName));
            }

            function getSourceFileText(fileName: string): string {
                let text: string = undefined;
                try {
                    text = Harness.IO.readFile(getFileNameInTheProjectTest(fileName));
                }
                catch (e) {
                    // text doesn't get defined.
                }
                return text;
            }

            function writeFile(fileName: string, data: string, writeByteOrderMark: boolean) {
                // convert file name to rooted name
                // if filename is not rooted - concat it with project root and then expand project root relative to current directory
                const diskFileName = ts.isRootedDiskPath(fileName)
                    ? fileName
                    : Harness.IO.resolvePath(ts.normalizeSlashes(testCase.projectRoot) + "/" + ts.normalizeSlashes(fileName));

                const currentDirectory = getCurrentDirectory();
                // compute file name relative to current directory (expanded project root)
                let diskRelativeName = ts.getRelativePathToDirectoryOrUrl(currentDirectory, diskFileName, currentDirectory, Harness.Compiler.getCanonicalFileName, /*isAbsolutePathAnUrl*/ false);
                if (ts.isRootedDiskPath(diskRelativeName) || diskRelativeName.substr(0, 3) === "../") {
                    // If the generated output file resides in the parent folder or is rooted path,
                    // we need to instead create files that can live in the project reference folder
                    // but make sure extension of these files matches with the fileName the compiler asked to write
                    diskRelativeName = "diskFile" + nonSubfolderDiskFiles +
                    (Harness.Compiler.isDTS(fileName) ? ts.Extension.Dts :
                    Harness.Compiler.isJS(fileName) ? ts.Extension.Js : ".js.map");
                    nonSubfolderDiskFiles++;
                }

                if (Harness.Compiler.isJS(fileName)) {
                    // Make sure if there is URl we have it cleaned up
                    const indexOfSourceMapUrl = data.lastIndexOf(`//# ${"sourceMappingURL"}=`); // This line can be seen as a sourceMappingURL comment
                    if (indexOfSourceMapUrl !== -1) {
                        data = data.substring(0, indexOfSourceMapUrl + 21) + cleanProjectUrl(data.substring(indexOfSourceMapUrl + 21));
                    }
                }
                else if (Harness.Compiler.isJSMap(fileName)) {
                    // Make sure sources list is cleaned
                    const sourceMapData = JSON.parse(data);
                    for (let i = 0; i < sourceMapData.sources.length; i++) {
                        sourceMapData.sources[i] = cleanProjectUrl(sourceMapData.sources[i]);
                    }
                    sourceMapData.sourceRoot = cleanProjectUrl(sourceMapData.sourceRoot);
                    data = JSON.stringify(sourceMapData);
                }

                const outputFilePath = getProjectOutputFolder(diskRelativeName, moduleKind);
                // Actual writing of file as in tc.ts
                function ensureDirectoryStructure(directoryname: string) {
                    if (directoryname) {
                        if (!Harness.IO.directoryExists(directoryname)) {
                            ensureDirectoryStructure(ts.getDirectoryPath(directoryname));
                            Harness.IO.createDirectory(directoryname);
                        }
                    }
                }
                ensureDirectoryStructure(ts.getDirectoryPath(ts.normalizePath(outputFilePath)));
                Harness.IO.writeFile(outputFilePath, data);

                outputFiles.push({ emittedFileName: fileName, code: data, fileName: diskRelativeName, writeByteOrderMark });
            }
        }

        function compileCompileDTsFiles(compilerResult: BatchCompileProjectTestCaseResult) {
            const allInputFiles: { emittedFileName: string; code: string; }[] = [];
            if (!compilerResult.program) {
                return;
            }
            const compilerOptions = compilerResult.program.getCompilerOptions();

            ts.forEach(compilerResult.program.getSourceFiles(), sourceFile => {
                if (sourceFile.isDeclarationFile) {
                    allInputFiles.unshift({ emittedFileName: sourceFile.fileName, code: sourceFile.text });
                }
                else if (!(compilerOptions.outFile || compilerOptions.out)) {
                    let emitOutputFilePathWithoutExtension: string = undefined;
                    if (compilerOptions.outDir) {
                        let sourceFilePath = ts.getNormalizedAbsolutePath(sourceFile.fileName, compilerResult.program.getCurrentDirectory());
                        sourceFilePath = sourceFilePath.replace(compilerResult.program.getCommonSourceDirectory(), "");
                        emitOutputFilePathWithoutExtension = ts.removeFileExtension(ts.combinePaths(compilerOptions.outDir, sourceFilePath));
                    }
                    else {
                        emitOutputFilePathWithoutExtension = ts.removeFileExtension(sourceFile.fileName);
                    }

                    const outputDtsFileName = emitOutputFilePathWithoutExtension + ts.Extension.Dts;
                    const file = findOutputDtsFile(outputDtsFileName);
                    if (file) {
                        allInputFiles.unshift(file);
                    }
                }
                else {
                    const outputDtsFileName = ts.removeFileExtension(compilerOptions.outFile || compilerOptions.out) + ts.Extension.Dts;
                    const outputDtsFile = findOutputDtsFile(outputDtsFileName);
                    if (!ts.contains(allInputFiles, outputDtsFile)) {
                        allInputFiles.unshift(outputDtsFile);
                    }
                }
            });

            // Dont allow config files since we are compiling existing source options
            return compileProjectFiles(compilerResult.moduleKind, compilerResult.configFileSourceFiles, getInputFiles, getSourceFileText, /*writeFile*/ ts.noop, compilerResult.compilerOptions);

            function findOutputDtsFile(fileName: string) {
                return ts.forEach(compilerResult.outputFiles, outputFile => outputFile.emittedFileName === fileName ? outputFile : undefined);
            }
            function getInputFiles() {
                return ts.map(allInputFiles, outputFile => outputFile.emittedFileName);
            }
            function getSourceFileText(fileName: string): string {
                for (const inputFile of allInputFiles) {
                    const isMatchingFile = ts.isRootedDiskPath(fileName)
                        ? ts.getNormalizedAbsolutePath(inputFile.emittedFileName, getCurrentDirectory()) === fileName
                        : inputFile.emittedFileName === fileName;

                    if (isMatchingFile) {
                        return inputFile.code;
                    }
                }
                return undefined;
            }
        }

        function getErrorsBaseline(compilerResult: CompileProjectFilesResult) {
            const inputSourceFiles = compilerResult.configFileSourceFiles.slice();
            if (compilerResult.program) {
                for (const sourceFile of compilerResult.program.getSourceFiles()) {
                    if (!Harness.isDefaultLibraryFile(sourceFile.fileName)) {
                        inputSourceFiles.push(sourceFile);
                    }
                }
            }

            const inputFiles = inputSourceFiles.map<Harness.Compiler.TestFile>(sourceFile => ({
                unitName: ts.isRootedDiskPath(sourceFile.fileName) ?
                    RunnerBase.removeFullPaths(sourceFile.fileName) :
                    sourceFile.fileName,
                content: sourceFile.text
            }));

            return Harness.Compiler.getErrorBaseline(inputFiles, compilerResult.errors);
        }

        const name = "Compiling project for " + testCase.scenario + ": testcase " + testCaseFileName;

        describe("projects tests", () => {
            describe(name, () => {
                function verifyCompilerResults(moduleKind: ts.ModuleKind) {
                    let compilerResult: BatchCompileProjectTestCaseResult;

                    function getCompilerResolutionInfo() {
                        const resolutionInfo: ProjectRunnerTestCaseResolutionInfo & ts.CompilerOptions = JSON.parse(JSON.stringify(testCase));
                        resolutionInfo.resolvedInputFiles = ts.map(compilerResult.program.getSourceFiles(), inputFile => {
                            return ts.convertToRelativePath(inputFile.fileName, getCurrentDirectory(), path => Harness.Compiler.getCanonicalFileName(path));
                        });
                        resolutionInfo.emittedFiles = ts.map(compilerResult.outputFiles, outputFile => {
                            return ts.convertToRelativePath(outputFile.emittedFileName, getCurrentDirectory(), path => Harness.Compiler.getCanonicalFileName(path));
                        });
                        return resolutionInfo;
                    }

                    it(name + ": " + moduleNameToString(moduleKind), () => {
                        // Compile using node
                        compilerResult = batchCompilerProjectTestCase(moduleKind);
                    });

                    it("Resolution information of (" + moduleNameToString(moduleKind) + "): " + testCaseFileName, () => {
                        Harness.Baseline.runBaseline(getBaselineFolder(compilerResult.moduleKind) + testCaseJustName + ".json", () => {
                            return JSON.stringify(getCompilerResolutionInfo(), undefined, "    ");
                        });
                    });


                    it("Errors for (" + moduleNameToString(moduleKind) + "): " + testCaseFileName, () => {
                        if (compilerResult.errors.length) {
                            Harness.Baseline.runBaseline(getBaselineFolder(compilerResult.moduleKind) + testCaseJustName + ".errors.txt", () => {
                                return getErrorsBaseline(compilerResult);
                            });
                        }
                    });

                    it("Baseline of emitted result (" + moduleNameToString(moduleKind) + "): " + testCaseFileName, () => {
                        if (testCase.baselineCheck) {
                            const errs: Error[] = [];
                            ts.forEach(compilerResult.outputFiles, outputFile => {
                                // There may be multiple files with different baselines. Run all and report at the end, else
                                // it stops copying the remaining emitted files from 'local/projectOutput' to 'local/project'.
                                try {
                                    Harness.Baseline.runBaseline(getBaselineFolder(compilerResult.moduleKind) + outputFile.fileName, () => {
                                        try {
                                            return Harness.IO.readFile(getProjectOutputFolder(outputFile.fileName, compilerResult.moduleKind));
                                        }
                                        catch (e) {
                                            return undefined;
                                        }
                                    });
                                }
                                catch (e) {
                                    errs.push(e);
                                }
                            });
                            if (errs.length) {
                                throw Error(errs.join("\n     "));
                            }
                        }
                    });

                    // it("SourceMapRecord for (" + moduleNameToString(moduleKind) + "): " + testCaseFileName, () => {
                    //     if (compilerResult.sourceMapData) {
                    //         Harness.Baseline.runBaseline(getBaselineFolder(compilerResult.moduleKind) + testCaseJustName + ".sourcemap.txt", () => {
                    //             return Harness.SourceMapRecorder.getSourceMapRecord(compilerResult.sourceMapData, compilerResult.program,
                    //                 ts.filter(compilerResult.outputFiles, outputFile => Harness.Compiler.isJS(outputFile.emittedFileName)));
                    //         });
                    //     }
                    // });

                    // Verify that all the generated .d.ts files compile
                    it("Errors in generated Dts files for (" + moduleNameToString(moduleKind) + "): " + testCaseFileName, () => {
                        if (!compilerResult.errors.length && testCase.declaration) {
                            const dTsCompileResult = compileCompileDTsFiles(compilerResult);
                            if (dTsCompileResult && dTsCompileResult.errors.length) {
                                Harness.Baseline.runBaseline(getBaselineFolder(compilerResult.moduleKind) + testCaseJustName + ".dts.errors.txt", () => {
                                    return getErrorsBaseline(dTsCompileResult);
                                });
                            }
                        }
                    });
                    after(() => {
                        compilerResult = undefined;
                    });
                }

                verifyCompilerResults(ts.ModuleKind.CommonJS);
                verifyCompilerResults(ts.ModuleKind.AMD);

                after(() => {
                    // Mocha holds onto the closure environment of the describe callback even after the test is done.
                    // Therefore we have to clean out large objects after the test is done.
                    testCase = undefined;
                    testFileText = undefined;
                    testCaseJustName = undefined;
                });
            });
        });
    }
}
