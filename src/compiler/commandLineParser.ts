/// <reference path="sys.ts"/>
/// <reference path="types.ts"/>
/// <reference path="core.ts"/>
/// <reference path="diagnosticInformationMap.generated.ts"/>
/// <reference path="scanner.ts"/>

namespace ts {
    /* @internal */
    export const compileOnSaveCommandLineOption: CommandLineOption = { name: "compileOnSave", type: "boolean" };
    /* @internal */
    export const optionDeclarations: CommandLineOption[] = [
        {
            name: "charset",
            type: "string",
        },
        compileOnSaveCommandLineOption,
        {
            name: "declaration",
            shortName: "d",
            type: "boolean",
            description: Diagnostics.Generates_corresponding_d_ts_file,
        },
        {
            name: "declarationDir",
            type: "string",
            isFilePath: true,
            paramType: Diagnostics.DIRECTORY,
        },
        {
            name: "diagnostics",
            type: "boolean",
        },
        {
            name: "extendedDiagnostics",
            type: "boolean",
            experimental: true
        },
        {
            name: "emitBOM",
            type: "boolean"
        },
        {
            name: "help",
            shortName: "h",
            type: "boolean",
            description: Diagnostics.Print_this_message,
        },
        {
            name: "help",
            shortName: "?",
            type: "boolean"
        },
        {
            name: "init",
            type: "boolean",
            description: Diagnostics.Initializes_a_TypeScript_project_and_creates_a_tsconfig_json_file,
        },
        {
            name: "inlineSourceMap",
            type: "boolean",
        },
        {
            name: "inlineSources",
            type: "boolean",
        },
        {
            name: "jsx",
            type: createMap({
                "preserve": JsxEmit.Preserve,
                "react": JsxEmit.React
            }),
            paramType: Diagnostics.KIND,
            description: Diagnostics.Specify_JSX_code_generation_Colon_preserve_or_react,
        },
        {
            name: "reactNamespace",
            type: "string",
            description: Diagnostics.Specify_the_object_invoked_for_createElement_and_spread_when_targeting_react_JSX_emit
        },
        {
            name: "jsxFactory",
            type: "string",
            description: Diagnostics.Specify_the_JSX_factory_function_to_use_when_targeting_react_JSX_emit_e_g_React_createElement_or_h
        },
        {
            name: "listFiles",
            type: "boolean",
        },
        {
            name: "locale",
            type: "string",
        },
        {
            name: "mapRoot",
            type: "string",
            isFilePath: true,
            description: Diagnostics.Specify_the_location_where_debugger_should_locate_map_files_instead_of_generated_locations,
            paramType: Diagnostics.LOCATION,
        },
        {
            name: "module",
            shortName: "m",
            type: createMap({
                "none": ModuleKind.None,
                "commonjs": ModuleKind.CommonJS,
                "amd": ModuleKind.AMD,
                "system": ModuleKind.System,
                "umd": ModuleKind.UMD,
                "es6": ModuleKind.ES2015,
                "es2015": ModuleKind.ES2015,
            }),
            description: Diagnostics.Specify_module_code_generation_Colon_commonjs_amd_system_umd_or_es2015,
            paramType: Diagnostics.KIND,
        },
        {
            name: "newLine",
            type: createMap({
                "crlf": NewLineKind.CarriageReturnLineFeed,
                "lf": NewLineKind.LineFeed
            }),
            description: Diagnostics.Specify_the_end_of_line_sequence_to_be_used_when_emitting_files_Colon_CRLF_dos_or_LF_unix,
            paramType: Diagnostics.NEWLINE,
        },
        {
            name: "noEmit",
            type: "boolean",
            description: Diagnostics.Do_not_emit_outputs,
        },
        {
            name: "noEmitHelpers",
            type: "boolean"
        },
        {
            name: "noEmitOnError",
            type: "boolean",
            description: Diagnostics.Do_not_emit_outputs_if_any_errors_were_reported,
        },
        {
            name: "noErrorTruncation",
            type: "boolean"
        },
        {
            name: "noImplicitAny",
            type: "boolean",
            description: Diagnostics.Raise_error_on_expressions_and_declarations_with_an_implied_any_type,
        },
        {
            name: "noImplicitThis",
            type: "boolean",
            description: Diagnostics.Raise_error_on_this_expressions_with_an_implied_any_type,
        },
        {
            name: "noUnusedLocals",
            type: "boolean",
            description: Diagnostics.Report_errors_on_unused_locals,
        },
        {
            name: "noUnusedParameters",
            type: "boolean",
            description: Diagnostics.Report_errors_on_unused_parameters,
        },
        {
            name: "noLib",
            type: "boolean",
        },
        {
            name: "noResolve",
            type: "boolean",
        },
        {
            name: "skipDefaultLibCheck",
            type: "boolean",
        },
        {
            name: "skipLibCheck",
            type: "boolean",
            description: Diagnostics.Skip_type_checking_of_declaration_files,
        },
        {
            name: "out",
            type: "string",
            isFilePath: false, // This is intentionally broken to support compatability with existing tsconfig files
            // for correct behaviour, please use outFile
            paramType: Diagnostics.FILE,
        },
        {
            name: "outFile",
            type: "string",
            isFilePath: true,
            description: Diagnostics.Concatenate_and_emit_output_to_single_file,
            paramType: Diagnostics.FILE,
        },
        {
            name: "outDir",
            type: "string",
            isFilePath: true,
            description: Diagnostics.Redirect_output_structure_to_the_directory,
            paramType: Diagnostics.DIRECTORY,
        },
        {
            name: "preserveConstEnums",
            type: "boolean",
            description: Diagnostics.Do_not_erase_const_enum_declarations_in_generated_code
        },
        {
            name: "pretty",
            description: Diagnostics.Stylize_errors_and_messages_using_color_and_context_experimental,
            type: "boolean"
        },
        {
            name: "project",
            shortName: "p",
            type: "string",
            isFilePath: true,
            description: Diagnostics.Compile_the_project_in_the_given_directory,
            paramType: Diagnostics.DIRECTORY
        },
        {
            name: "removeComments",
            type: "boolean",
            description: Diagnostics.Do_not_emit_comments_to_output,
        },
        {
            name: "rootDir",
            type: "string",
            isFilePath: true,
            paramType: Diagnostics.LOCATION,
            description: Diagnostics.Specify_the_root_directory_of_input_files_Use_to_control_the_output_directory_structure_with_outDir,
        },
        {
            name: "isolatedModules",
            type: "boolean",
        },
        {
            name: "sourceMap",
            type: "boolean",
            description: Diagnostics.Generates_corresponding_map_file,
        },
        {
            name: "sourceRoot",
            type: "string",
            isFilePath: true,
            description: Diagnostics.Specify_the_location_where_debugger_should_locate_TypeScript_files_instead_of_source_locations,
            paramType: Diagnostics.LOCATION,
        },
        {
            name: "suppressExcessPropertyErrors",
            type: "boolean",
            description: Diagnostics.Suppress_excess_property_checks_for_object_literals,
            experimental: true
        },
        {
            name: "suppressImplicitAnyIndexErrors",
            type: "boolean",
            description: Diagnostics.Suppress_noImplicitAny_errors_for_indexing_objects_lacking_index_signatures,
        },
        {
            name: "stripInternal",
            type: "boolean",
            description: Diagnostics.Do_not_emit_declarations_for_code_that_has_an_internal_annotation,
            experimental: true
        },
        {
            name: "target",
            shortName: "t",
            type: createMap({
                "es3": ScriptTarget.ES3,
                "es5": ScriptTarget.ES5,
                "es6": ScriptTarget.ES2015,
                "es2015": ScriptTarget.ES2015,
                "es2016": ScriptTarget.ES2016,
                "es2017": ScriptTarget.ES2017,
                "esnext": ScriptTarget.ESNext,
            }),
            description: Diagnostics.Specify_ECMAScript_target_version_Colon_ES3_default_ES5_ES2015_ES2016_ES2017_or_ESNEXT,
            paramType: Diagnostics.VERSION,
        },
        {
            name: "version",
            shortName: "v",
            type: "boolean",
            description: Diagnostics.Print_the_compiler_s_version,
        },
        {
            name: "watch",
            shortName: "w",
            type: "boolean",
            description: Diagnostics.Watch_input_files,
        },
        {
            name: "experimentalDecorators",
            type: "boolean",
            description: Diagnostics.Enables_experimental_support_for_ES7_decorators
        },
        {
            name: "emitDecoratorMetadata",
            type: "boolean",
            experimental: true,
            description: Diagnostics.Enables_experimental_support_for_emitting_type_metadata_for_decorators
        },
        {
            name: "moduleResolution",
            type: createMap({
                "node": ModuleResolutionKind.NodeJs,
                "classic": ModuleResolutionKind.Classic,
            }),
            description: Diagnostics.Specify_module_resolution_strategy_Colon_node_Node_js_or_classic_TypeScript_pre_1_6,
            paramType: Diagnostics.STRATEGY,
        },
        {
            name: "allowUnusedLabels",
            type: "boolean",
            description: Diagnostics.Do_not_report_errors_on_unused_labels
        },
        {
            name: "noImplicitReturns",
            type: "boolean",
            description: Diagnostics.Report_error_when_not_all_code_paths_in_function_return_a_value
        },
        {
            name: "noFallthroughCasesInSwitch",
            type: "boolean",
            description: Diagnostics.Report_errors_for_fallthrough_cases_in_switch_statement
        },
        {
            name: "allowUnreachableCode",
            type: "boolean",
            description: Diagnostics.Do_not_report_errors_on_unreachable_code
        },
        {
            name: "forceConsistentCasingInFileNames",
            type: "boolean",
            description: Diagnostics.Disallow_inconsistently_cased_references_to_the_same_file
        },
        {
            name: "baseUrl",
            type: "string",
            isFilePath: true,
            description: Diagnostics.Base_directory_to_resolve_non_absolute_module_names
        },
        {
            // this option can only be specified in tsconfig.json
            // use type = object to copy the value as-is
            name: "paths",
            type: "object",
            isTSConfigOnly: true
        },
        {
            // this option can only be specified in tsconfig.json
            // use type = object to copy the value as-is
            name: "rootDirs",
            type: "list",
            isTSConfigOnly: true,
            element: {
                name: "rootDirs",
                type: "string",
                isFilePath: true
            }
        },
        {
            name: "typeRoots",
            type: "list",
            element: {
                name: "typeRoots",
                type: "string",
                isFilePath: true
            }
        },
        {
            name: "types",
            type: "list",
            element: {
                name: "types",
                type: "string"
            },
            description: Diagnostics.Type_declaration_files_to_be_included_in_compilation
        },
        {
            name: "traceResolution",
            type: "boolean",
            description: Diagnostics.Enable_tracing_of_the_name_resolution_process
        },
        {
            name: "allowJs",
            type: "boolean",
            description: Diagnostics.Allow_javascript_files_to_be_compiled
        },
        {
            name: "allowSyntheticDefaultImports",
            type: "boolean",
            description: Diagnostics.Allow_default_imports_from_modules_with_no_default_export_This_does_not_affect_code_emit_just_typechecking
        },
        {
            name: "noImplicitUseStrict",
            type: "boolean",
            description: Diagnostics.Do_not_emit_use_strict_directives_in_module_output
        },
        {
            name: "maxNodeModuleJsDepth",
            type: "number",
            description: Diagnostics.The_maximum_dependency_depth_to_search_under_node_modules_and_load_JavaScript_files
        },
        {
            name: "listEmittedFiles",
            type: "boolean"
        },
        {
            name: "lib",
            type: "list",
            element: {
                name: "lib",
                type: createMap({
                    // JavaScript only
                    "es5": "lib.es5.d.ts",
                    "es6": "lib.es2015.d.ts",
                    "es2015": "lib.es2015.d.ts",
                    "es7": "lib.es2016.d.ts",
                    "es2016": "lib.es2016.d.ts",
                    "es2017": "lib.es2017.d.ts",
                    // Host only
                    "dom": "lib.dom.d.ts",
                    "dom.iterable": "lib.dom.iterable.d.ts",
                    "webworker": "lib.webworker.d.ts",
                    "scripthost": "lib.scripthost.d.ts",
                    // ES2015 Or ESNext By-feature options
                    "es2015.core": "lib.es2015.core.d.ts",
                    "es2015.collection": "lib.es2015.collection.d.ts",
                    "es2015.generator": "lib.es2015.generator.d.ts",
                    "es2015.iterable": "lib.es2015.iterable.d.ts",
                    "es2015.promise": "lib.es2015.promise.d.ts",
                    "es2015.proxy": "lib.es2015.proxy.d.ts",
                    "es2015.reflect": "lib.es2015.reflect.d.ts",
                    "es2015.symbol": "lib.es2015.symbol.d.ts",
                    "es2015.symbol.wellknown": "lib.es2015.symbol.wellknown.d.ts",
                    "es2016.array.include": "lib.es2016.array.include.d.ts",
                    "es2017.object": "lib.es2017.object.d.ts",
                    "es2017.sharedmemory": "lib.es2017.sharedmemory.d.ts",
                    "es2017.string": "lib.es2017.string.d.ts",
                }),
            },
            description: Diagnostics.Specify_library_files_to_be_included_in_the_compilation_Colon
        },
        {
            name: "disableSizeLimit",
            type: "boolean"
        },
        {
            name: "strictNullChecks",
            type: "boolean",
            description: Diagnostics.Enable_strict_null_checks
        },
        {
            name: "importHelpers",
            type: "boolean",
            description: Diagnostics.Import_emit_helpers_from_tslib
        },
        {
            name: "alwaysStrict",
            type: "boolean",
            description: Diagnostics.Parse_in_strict_mode_and_emit_use_strict_for_each_source_file
        }
    ];

    /* @internal */
    export let typeAcquisitionDeclarations: CommandLineOption[] = [
        {
            /* @deprecated typingOptions.enableAutoDiscovery
             * Use typeAcquisition.enable instead.
             */
            name: "enableAutoDiscovery",
            type: "boolean",
        },
        {
            name: "enable",
            type: "boolean",
        },
        {
            name: "include",
            type: "list",
            element: {
                name: "include",
                type: "string"
            }
        },
        {
            name: "exclude",
            type: "list",
            element: {
                name: "exclude",
                type: "string"
            }
        }
    ];

    /* @internal */
    export interface OptionNameMap {
        optionNameMap: Map<CommandLineOption>;
        shortOptionNames: Map<string>;
    }

    /* @internal */
    export const defaultInitCompilerOptions: CompilerOptions = {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES5,
        noImplicitAny: false,
        sourceMap: false,
    };

    let optionNameMapCache: OptionNameMap;

    /* @internal */
    export function convertEnableAutoDiscoveryToEnable(typeAcquisition: TypeAcquisition): TypeAcquisition {
        // Convert deprecated typingOptions.enableAutoDiscovery to typeAcquisition.enable
        if (typeAcquisition && typeAcquisition.enableAutoDiscovery !== undefined && typeAcquisition.enable === undefined) {
            const result: TypeAcquisition = {
                enable: typeAcquisition.enableAutoDiscovery,
                include: typeAcquisition.include || [],
                exclude: typeAcquisition.exclude || []
            };
           return result;
        }
        return typeAcquisition;
    }

    /* @internal */
    export function getOptionNameMap(): OptionNameMap {
        if (optionNameMapCache) {
            return optionNameMapCache;
        }

        const optionNameMap = createMap<CommandLineOption>();
        const shortOptionNames = createMap<string>();
        forEach(optionDeclarations, option => {
            optionNameMap[option.name.toLowerCase()] = option;
            if (option.shortName) {
                shortOptionNames[option.shortName] = option.name;
            }
        });

        optionNameMapCache = { optionNameMap, shortOptionNames };
        return optionNameMapCache;
    }

    /* @internal */
    export function createCompilerDiagnosticForInvalidCustomType(opt: CommandLineOptionOfCustomType): Diagnostic {
        const namesOfType = Object.keys(opt.type).map(key => `'${key}'`).join(", ");
        return createCompilerDiagnostic(Diagnostics.Argument_for_0_option_must_be_Colon_1, `--${opt.name}`, namesOfType);
    }

    /* @internal */
    export function parseCustomTypeOption(opt: CommandLineOptionOfCustomType, value: string, errors: Diagnostic[]) {
        return convertJsonOptionOfCustomType(opt, trimString(value || ""), errors);
    }

    /* @internal */
    export function parseListTypeOption(opt: CommandLineOptionOfListType, value = "", errors: Diagnostic[]): (string | number)[] | undefined {
        value = trimString(value);
        if (startsWith(value, "-")) {
            return undefined;
        }
        if (value === "") {
            return [];
        }
        const values = value.split(",");
        switch (opt.element.type) {
            case "number":
                return map(values, parseInt);
            case "string":
                return map(values, v => v || "");
            default:
                return filter(map(values, v => parseCustomTypeOption(<CommandLineOptionOfCustomType>opt.element, v, errors)), v => !!v);
        }
    }

    export function parseCommandLine(commandLine: string[], readFile?: (path: string) => string): ParsedCommandLine {
        const options: CompilerOptions = {};
        const fileNames: string[] = [];
        const errors: Diagnostic[] = [];
        const { optionNameMap, shortOptionNames } = getOptionNameMap();

        parseStrings(commandLine);
        return {
            options,
            fileNames,
            errors
        };

        function parseStrings(args: string[]) {
            let i = 0;
            while (i < args.length) {
                let s = args[i];
                i++;
                if (s.charCodeAt(0) === CharacterCodes.at) {
                    parseResponseFile(s.slice(1));
                }
                else if (s.charCodeAt(0) === CharacterCodes.minus) {
                    s = s.slice(s.charCodeAt(1) === CharacterCodes.minus ? 2 : 1).toLowerCase();

                    // Try to translate short option names to their full equivalents.
                    if (s in shortOptionNames) {
                        s = shortOptionNames[s];
                    }

                    if (s in optionNameMap) {
                        const opt = optionNameMap[s];

                        if (opt.isTSConfigOnly) {
                            errors.push(createCompilerDiagnostic(Diagnostics.Option_0_can_only_be_specified_in_tsconfig_json_file, opt.name));
                        }
                        else {
                            // Check to see if no argument was provided (e.g. "--locale" is the last command-line argument).
                            if (!args[i] && opt.type !== "boolean") {
                                errors.push(createCompilerDiagnostic(Diagnostics.Compiler_option_0_expects_an_argument, opt.name));
                            }

                            switch (opt.type) {
                                case "number":
                                    options[opt.name] = parseInt(args[i]);
                                    i++;
                                    break;
                                case "boolean":
                                    // boolean flag has optional value true, false, others
                                    let optValue = args[i];
                                    options[opt.name] = optValue !== "false";
                                    // consume next argument as boolean flag value
                                    if (optValue === "false" || optValue === "true") {
                                        i++;
                                    }
                                    break;
                                case "string":
                                    options[opt.name] = args[i] || "";
                                    i++;
                                    break;
                                case "list":
                                    const result = parseListTypeOption(<CommandLineOptionOfListType>opt, args[i], errors);
                                    options[opt.name] = result || [];
                                    if (result) {
                                        i++;
                                    }
                                    break;
                                // If not a primitive, the possible types are specified in what is effectively a map of options.
                                default:
                                    options[opt.name] = parseCustomTypeOption(<CommandLineOptionOfCustomType>opt, args[i], errors);
                                    i++;
                                    break;
                            }
                        }
                    }
                    else {
                        errors.push(createCompilerDiagnostic(Diagnostics.Unknown_compiler_option_0, s));
                    }
                }
                else {
                    fileNames.push(s);
                }
            }
        }

        function parseResponseFile(fileName: string) {
            const text = readFile ? readFile(fileName) : sys.readFile(fileName);

            if (!text) {
                errors.push(createCompilerDiagnostic(Diagnostics.File_0_not_found, fileName));
                return;
            }

            const args: string[] = [];
            let pos = 0;
            while (true) {
                while (pos < text.length && text.charCodeAt(pos) <= CharacterCodes.space) pos++;
                if (pos >= text.length) break;
                const start = pos;
                if (text.charCodeAt(start) === CharacterCodes.doubleQuote) {
                    pos++;
                    while (pos < text.length && text.charCodeAt(pos) !== CharacterCodes.doubleQuote) pos++;
                    if (pos < text.length) {
                        args.push(text.substring(start + 1, pos));
                        pos++;
                    }
                    else {
                        errors.push(createCompilerDiagnostic(Diagnostics.Unterminated_quoted_string_in_response_file_0, fileName));
                    }
                }
                else {
                    while (text.charCodeAt(pos) > CharacterCodes.space) pos++;
                    args.push(text.substring(start, pos));
                }
            }
            parseStrings(args);
        }
    }

    /**
      * Read tsconfig.json file
      * @param fileName The path to the config file
      */
    export function readConfigFile(fileName: string, readFile: (path: string) => string): { config?: any; error?: Diagnostic } {
        let text = "";
        try {
            text = readFile(fileName);
        }
        catch (e) {
            return { error: createCompilerDiagnostic(Diagnostics.Cannot_read_file_0_Colon_1, fileName, e.message) };
        }
        return parseConfigFileTextToJson(fileName, text);
    }

    /**
      * Parse the text of the tsconfig.json file
      * @param fileName The path to the config file
      * @param jsonText The text of the config file
      */
    export function parseConfigFileTextToJson(fileName: string, jsonText: string, stripComments = true): { config?: any; error?: Diagnostic } {
        try {
            const jsonTextToParse = stripComments ? removeComments(jsonText) : jsonText;
            return { config: /\S/.test(jsonTextToParse) ? JSON.parse(jsonTextToParse) : {} };
        }
        catch (e) {
            return { error: createCompilerDiagnostic(Diagnostics.Failed_to_parse_file_0_Colon_1, fileName, e.message) };
        }
    }

    /**
     * Generate tsconfig configuration when running command line "--init"
     * @param options commandlineOptions to be generated into tsconfig.json
     * @param fileNames array of filenames to be generated into tsconfig.json
     */
    /* @internal */
    export function generateTSConfig(options: CompilerOptions, fileNames: string[]): { compilerOptions: Map<CompilerOptionsValue> } {
        const compilerOptions = extend(options, defaultInitCompilerOptions);
        const configurations: any = {
            compilerOptions: serializeCompilerOptions(compilerOptions)
        };
        if (fileNames && fileNames.length) {
            // only set the files property if we have at least one file
            configurations.files = fileNames;
        }

        return configurations;

        function getCustomTypeMapOfCommandLineOption(optionDefinition: CommandLineOption): Map<string | number> | undefined {
            if (optionDefinition.type === "string" || optionDefinition.type === "number" || optionDefinition.type === "boolean") {
                // this is of a type CommandLineOptionOfPrimitiveType
                return undefined;
            }
            else if (optionDefinition.type === "list") {
                return getCustomTypeMapOfCommandLineOption((<CommandLineOptionOfListType>optionDefinition).element);
            }
            else {
                return (<CommandLineOptionOfCustomType>optionDefinition).type;
            }
        }

        function getNameOfCompilerOptionValue(value: CompilerOptionsValue, customTypeMap: MapLike<string | number>): string | undefined {
            // There is a typeMap associated with this command-line option so use it to map value back to its name
            for (const key in customTypeMap) {
                if (customTypeMap[key] === value) {
                    return key;
                }
            }
            return undefined;
        }

        function serializeCompilerOptions(options: CompilerOptions): Map<CompilerOptionsValue> {
            const result = createMap<CompilerOptionsValue>();
            const optionsNameMap = getOptionNameMap().optionNameMap;

            for (const name in options) {
                if (hasProperty(options, name)) {
                    // tsconfig only options cannot be specified via command line,
                    // so we can assume that only types that can appear here string | number | boolean
                    switch (name) {
                        case "init":
                        case "watch":
                        case "version":
                        case "help":
                        case "project":
                            break;
                        default:
                            const value = options[name];
                            let optionDefinition = optionsNameMap[name.toLowerCase()];
                            if (optionDefinition) {
                                const customTypeMap = getCustomTypeMapOfCommandLineOption(optionDefinition);
                                if (!customTypeMap) {
                                    // There is no map associated with this compiler option then use the value as-is
                                    // This is the case if the value is expect to be string, number, boolean or list of string
                                    result[name] = value;
                                }
                                else {
                                    if (optionDefinition.type === "list") {
                                        const convertedValue: string[] = [];
                                        for (const element of value as (string | number)[]) {
                                            convertedValue.push(getNameOfCompilerOptionValue(element, customTypeMap));
                                        }
                                        result[name] = convertedValue;
                                    }
                                    else {
                                        // There is a typeMap associated with this command-line option so use it to map value back to its name
                                        result[name] = getNameOfCompilerOptionValue(value, customTypeMap);
                                    }
                                }
                            }
                            break;
                    }
                }
            }
            return result;
        }
    }

    /**
     * Remove the comments from a json like text.
     * Comments can be single line comments (starting with # or //) or multiline comments using / * * /
     *
     * This method replace comment content by whitespace rather than completely remove them to keep positions in json parsing error reporting accurate.
     */
    function removeComments(jsonText: string): string {
        let output = "";
        const scanner = createScanner(ScriptTarget.ES5, /* skipTrivia */ false, LanguageVariant.Standard, jsonText);
        let token: SyntaxKind;
        while ((token = scanner.scan()) !== SyntaxKind.EndOfFileToken) {
            switch (token) {
                case SyntaxKind.SingleLineCommentTrivia:
                case SyntaxKind.MultiLineCommentTrivia:
                    // replace comments with whitespace to preserve original character positions
                    output += scanner.getTokenText().replace(/\S/g, " ");
                    break;
                default:
                    output += scanner.getTokenText();
                    break;
            }
        }
        return output;
    }

    /**
      * Parse the contents of a config file (tsconfig.json).
      * @param json The contents of the config file to parse
      * @param host Instance of ParseConfigHost used to enumerate files in folder.
      * @param basePath A root directory to resolve relative path entries in the config
      *    file to. e.g. outDir
      */
    export function parseJsonConfigFileContent(json: any, host: ParseConfigHost, basePath: string, existingOptions: CompilerOptions = {}, configFileName?: string, resolutionStack: Path[] = [], extraFileExtensions: FileExtensionInfo[] = []): ParsedCommandLine {
        const errors: Diagnostic[] = [];
        const getCanonicalFileName = createGetCanonicalFileName(host.useCaseSensitiveFileNames);
        const resolvedPath = toPath(configFileName || "", basePath, getCanonicalFileName);
        if (resolutionStack.indexOf(resolvedPath) >= 0) {
            return {
                options: {},
                fileNames: [],
                typeAcquisition: {},
                raw: json,
                errors: [createCompilerDiagnostic(Diagnostics.Circularity_detected_while_resolving_configuration_Colon_0, [...resolutionStack, resolvedPath].join(" -> "))],
                wildcardDirectories: {}
            };
        }

        let options: CompilerOptions = convertCompilerOptionsFromJsonWorker(json["compilerOptions"], basePath, errors, configFileName);
        // typingOptions has been deprecated and is only supported for backward compatibility purposes.
        // It should be removed in future releases - use typeAcquisition instead.
        const jsonOptions = json["typeAcquisition"] || json["typingOptions"];
        const typeAcquisition: TypeAcquisition = convertTypeAcquisitionFromJsonWorker(jsonOptions, basePath, errors, configFileName);

        if (json["extends"]) {
            let [include, exclude, files, baseOptions]: [string[], string[], string[], CompilerOptions] = [undefined, undefined, undefined, {}];
            if (typeof json["extends"] === "string") {
                [include, exclude, files, baseOptions] = (tryExtendsName(json["extends"]) || [include, exclude, files, baseOptions]);
            }
            else {
                errors.push(createCompilerDiagnostic(Diagnostics.Compiler_option_0_requires_a_value_of_type_1, "extends", "string"));
            }
            if (include && !json["include"]) {
                json["include"] = include;
            }
            if (exclude && !json["exclude"]) {
                json["exclude"] = exclude;
            }
            if (files && !json["files"]) {
                json["files"] = files;
            }
            options = assign({}, baseOptions, options);
        }

        options = extend(existingOptions, options);
        options.configFilePath = configFileName;

        const { fileNames, wildcardDirectories } = getFileNames(errors);
        const compileOnSave = convertCompileOnSaveOptionFromJson(json, basePath, errors);

        return {
            options,
            fileNames,
            typeAcquisition,
            raw: json,
            errors,
            wildcardDirectories,
            compileOnSave
        };

        function tryExtendsName(extendedConfig: string): [string[], string[], string[], CompilerOptions] {
            // If the path isn't a rooted or relative path, don't try to resolve it (we reserve the right to special case module-id like paths in the future)
            if (!(isRootedDiskPath(extendedConfig) || startsWith(normalizeSlashes(extendedConfig), "./") || startsWith(normalizeSlashes(extendedConfig), "../"))) {
                errors.push(createCompilerDiagnostic(Diagnostics.A_path_in_an_extends_option_must_be_relative_or_rooted_but_0_is_not, extendedConfig));
                return;
            }
            let extendedConfigPath = toPath(extendedConfig, basePath, getCanonicalFileName);
            if (!host.fileExists(extendedConfigPath) && !endsWith(extendedConfigPath, ".json")) {
                extendedConfigPath = `${extendedConfigPath}.json` as Path;
                if (!host.fileExists(extendedConfigPath)) {
                    errors.push(createCompilerDiagnostic(Diagnostics.File_0_does_not_exist, extendedConfig));
                    return;
                }
            }
            const extendedResult = readConfigFile(extendedConfigPath, path => host.readFile(path));
            if (extendedResult.error) {
                errors.push(extendedResult.error);
                return;
            }
            const extendedDirname = getDirectoryPath(extendedConfigPath);
            const relativeDifference = convertToRelativePath(extendedDirname, basePath, getCanonicalFileName);
            const updatePath: (path: string) => string = path => isRootedDiskPath(path) ? path : combinePaths(relativeDifference, path);
            // Merge configs (copy the resolution stack so it is never reused between branches in potential diamond-problem scenarios)
            const result = parseJsonConfigFileContent(extendedResult.config, host, extendedDirname, /*existingOptions*/undefined, getBaseFileName(extendedConfigPath), resolutionStack.concat([resolvedPath]));
            errors.push(...result.errors);
            const [include, exclude, files] = map(["include", "exclude", "files"], key => {
                if (!json[key] && extendedResult.config[key]) {
                    return map(extendedResult.config[key], updatePath);
                }
            });
            return [include, exclude, files, result.options];
        }

        function getFileNames(errors: Diagnostic[]): ExpandResult {
            let fileNames: string[];
            if (hasProperty(json, "files")) {
                if (isArray(json["files"])) {
                    fileNames = <string[]>json["files"];
                    if (fileNames.length === 0) {
                        errors.push(createCompilerDiagnostic(Diagnostics.The_files_list_in_config_file_0_is_empty, configFileName || "tsconfig.json"));
                    }
                }
                else {
                    errors.push(createCompilerDiagnostic(Diagnostics.Compiler_option_0_requires_a_value_of_type_1, "files", "Array"));
                }
            }

            let includeSpecs: string[];
            if (hasProperty(json, "include")) {
                if (isArray(json["include"])) {
                    includeSpecs = <string[]>json["include"];
                }
                else {
                    errors.push(createCompilerDiagnostic(Diagnostics.Compiler_option_0_requires_a_value_of_type_1, "include", "Array"));
                }
            }

            let excludeSpecs: string[];
            if (hasProperty(json, "exclude")) {
                if (isArray(json["exclude"])) {
                    excludeSpecs = <string[]>json["exclude"];
                }
                else {
                    errors.push(createCompilerDiagnostic(Diagnostics.Compiler_option_0_requires_a_value_of_type_1, "exclude", "Array"));
                }
            }
            else if (hasProperty(json, "excludes")) {
                errors.push(createCompilerDiagnostic(Diagnostics.Unknown_option_excludes_Did_you_mean_exclude));
            }
            else {
                // If no includes were specified, exclude common package folders and the outDir
                excludeSpecs = includeSpecs ? [] : ["node_modules", "bower_components", "jspm_packages"];

                const outDir = json["compilerOptions"] && json["compilerOptions"]["outDir"];
                if (outDir) {
                    excludeSpecs.push(outDir);
                }
            }

            if (fileNames === undefined && includeSpecs === undefined) {
                includeSpecs = ["**/*"];
            }

            const result = matchFileNames(fileNames, includeSpecs, excludeSpecs, basePath, options, host, errors, extraFileExtensions);

            if (result.fileNames.length === 0 && !hasProperty(json, "files") && resolutionStack.length === 0) {
                errors.push(
                    createCompilerDiagnostic(
                        Diagnostics.No_inputs_were_found_in_config_file_0_Specified_include_paths_were_1_and_exclude_paths_were_2,
                        configFileName || "tsconfig.json",
                        JSON.stringify(includeSpecs || []),
                        JSON.stringify(excludeSpecs || [])));
            }

            return result;
        }
    }

    export function convertCompileOnSaveOptionFromJson(jsonOption: any, basePath: string, errors: Diagnostic[]): boolean {
        if (!hasProperty(jsonOption, compileOnSaveCommandLineOption.name)) {
            return false;
        }
        const result = convertJsonOption(compileOnSaveCommandLineOption, jsonOption["compileOnSave"], basePath, errors);
        if (typeof result === "boolean" && result) {
            return result;
        }
        return false;
    }

    export function convertCompilerOptionsFromJson(jsonOptions: any, basePath: string, configFileName?: string): { options: CompilerOptions, errors: Diagnostic[] } {
        const errors: Diagnostic[] = [];
        const options = convertCompilerOptionsFromJsonWorker(jsonOptions, basePath, errors, configFileName);
        return { options, errors };
    }

    export function convertTypeAcquisitionFromJson(jsonOptions: any, basePath: string, configFileName?: string): { options: TypeAcquisition, errors: Diagnostic[] } {
        const errors: Diagnostic[] = [];
        const options = convertTypeAcquisitionFromJsonWorker(jsonOptions, basePath, errors, configFileName);
        return { options, errors };
    }

    function convertCompilerOptionsFromJsonWorker(jsonOptions: any,
        basePath: string, errors: Diagnostic[], configFileName?: string): CompilerOptions {

        const options: CompilerOptions = getBaseFileName(configFileName) === "jsconfig.json"
            ? { allowJs: true, maxNodeModuleJsDepth: 2, allowSyntheticDefaultImports: true, skipLibCheck: true }
            : {};
        convertOptionsFromJson(optionDeclarations, jsonOptions, basePath, options, Diagnostics.Unknown_compiler_option_0, errors);
        return options;
    }

    function convertTypeAcquisitionFromJsonWorker(jsonOptions: any,
        basePath: string, errors: Diagnostic[], configFileName?: string): TypeAcquisition {

        const options: TypeAcquisition = { enable: getBaseFileName(configFileName) === "jsconfig.json", include: [], exclude: [] };
        const typeAcquisition = convertEnableAutoDiscoveryToEnable(jsonOptions);
        convertOptionsFromJson(typeAcquisitionDeclarations, typeAcquisition, basePath, options, Diagnostics.Unknown_type_acquisition_option_0, errors);

        return options;
    }

    function convertOptionsFromJson(optionDeclarations: CommandLineOption[], jsonOptions: any, basePath: string,
        defaultOptions: CompilerOptions | TypeAcquisition, diagnosticMessage: DiagnosticMessage, errors: Diagnostic[]) {

        if (!jsonOptions) {
            return;
        }

        const optionNameMap = arrayToMap(optionDeclarations, opt => opt.name);

        for (const id in jsonOptions) {
            if (id in optionNameMap) {
                const opt = optionNameMap[id];
                defaultOptions[opt.name] = convertJsonOption(opt, jsonOptions[id], basePath, errors);
            }
            else {
                errors.push(createCompilerDiagnostic(diagnosticMessage, id));
            }
        }
    }

    function convertJsonOption(opt: CommandLineOption, value: any, basePath: string, errors: Diagnostic[]): CompilerOptionsValue {
        const optType = opt.type;
        const expectedType = typeof optType === "string" ? optType : "string";
        if (optType === "list" && isArray(value)) {
            return convertJsonOptionOfListType(<CommandLineOptionOfListType>opt, value, basePath, errors);
        }
        else if (typeof value === expectedType) {
            if (typeof optType !== "string") {
                return convertJsonOptionOfCustomType(<CommandLineOptionOfCustomType>opt, value, errors);
            }
            else {
                if (opt.isFilePath) {
                    value = normalizePath(combinePaths(basePath, value));
                    if (value === "") {
                        value = ".";
                    }
                }
            }
            return value;
        }
        else {
            errors.push(createCompilerDiagnostic(Diagnostics.Compiler_option_0_requires_a_value_of_type_1, opt.name, expectedType));
        }
    }

    function convertJsonOptionOfCustomType(opt: CommandLineOptionOfCustomType, value: string, errors: Diagnostic[]) {
        const key = value.toLowerCase();
        if (key in opt.type) {
            return opt.type[key];
        }
        else {
            errors.push(createCompilerDiagnosticForInvalidCustomType(opt));
        }
    }

    function convertJsonOptionOfListType(option: CommandLineOptionOfListType, values: any[], basePath: string, errors: Diagnostic[]): any[] {
        return filter(map(values, v => convertJsonOption(option.element, v, basePath, errors)), v => !!v);
    }

    function trimString(s: string) {
        return typeof s.trim === "function" ? s.trim() : s.replace(/^[\s]+|[\s]+$/g, "");
    }

    /**
     * Tests for a path that ends in a recursive directory wildcard.
     * Matches **, \**, **\, and \**\, but not a**b.
     *
     * NOTE: used \ in place of / above to avoid issues with multiline comments.
     *
     * Breakdown:
     *  (^|\/)      # matches either the beginning of the string or a directory separator.
     *  \*\*        # matches the recursive directory wildcard "**".
     *  \/?$        # matches an optional trailing directory separator at the end of the string.
     */
    const invalidTrailingRecursionPattern = /(^|\/)\*\*\/?$/;

    /**
     * Tests for a path with multiple recursive directory wildcards.
     * Matches **\** and **\a\**, but not **\a**b.
     *
     * NOTE: used \ in place of / above to avoid issues with multiline comments.
     *
     * Breakdown:
     *  (^|\/)      # matches either the beginning of the string or a directory separator.
     *  \*\*\/      # matches a recursive directory wildcard "**" followed by a directory separator.
     *  (.*\/)?     # optionally matches any number of characters followed by a directory separator.
     *  \*\*        # matches a recursive directory wildcard "**"
     *  ($|\/)      # matches either the end of the string or a directory separator.
     */
    const invalidMultipleRecursionPatterns = /(^|\/)\*\*\/(.*\/)?\*\*($|\/)/;

    /**
     * Tests for a path where .. appears after a recursive directory wildcard.
     * Matches **\..\*, **\a\..\*, and **\.., but not ..\**\*
     *
     * NOTE: used \ in place of / above to avoid issues with multiline comments.
     *
     * Breakdown:
     *  (^|\/)      # matches either the beginning of the string or a directory separator.
     *  \*\*\/      # matches a recursive directory wildcard "**" followed by a directory separator.
     *  (.*\/)?     # optionally matches any number of characters followed by a directory separator.
     *  \.\.        # matches a parent directory path component ".."
     *  ($|\/)      # matches either the end of the string or a directory separator.
     */
    const invalidDotDotAfterRecursiveWildcardPattern = /(^|\/)\*\*\/(.*\/)?\.\.($|\/)/;

    /**
     * Tests for a path containing a wildcard character in a directory component of the path.
     * Matches \*\, \?\, and \a*b\, but not \a\ or \a\*.
     *
     * NOTE: used \ in place of / above to avoid issues with multiline comments.
     *
     * Breakdown:
     *  \/          # matches a directory separator.
     *  [^/]*?      # matches any number of characters excluding directory separators (non-greedy).
     *  [*?]        # matches either a wildcard character (* or ?)
     *  [^/]*       # matches any number of characters excluding directory separators (greedy).
     *  \/          # matches a directory separator.
     */
    const watchRecursivePattern = /\/[^/]*?[*?][^/]*\//;

    /**
     * Matches the portion of a wildcard path that does not contain wildcards.
     * Matches \a of \a\*, or \a\b\c of \a\b\c\?\d.
     *
     * NOTE: used \ in place of / above to avoid issues with multiline comments.
     *
     * Breakdown:
     *  ^                   # matches the beginning of the string
     *  [^*?]*              # matches any number of non-wildcard characters
     *  (?=\/[^/]*[*?])     # lookahead that matches a directory separator followed by
     *                      # a path component that contains at least one wildcard character (* or ?).
     */
    const wildcardDirectoryPattern = /^[^*?]*(?=\/[^/]*[*?])/;

    /**
     * Expands an array of file specifications.
     *
     * @param fileNames The literal file names to include.
     * @param include The wildcard file specifications to include.
     * @param exclude The wildcard file specifications to exclude.
     * @param basePath The base path for any relative file specifications.
     * @param options Compiler options.
     * @param host The host used to resolve files and directories.
     * @param errors An array for diagnostic reporting.
     */
    function matchFileNames(fileNames: string[], include: string[], exclude: string[], basePath: string, options: CompilerOptions, host: ParseConfigHost, errors: Diagnostic[], extraFileExtensions: FileExtensionInfo[]): ExpandResult {
        basePath = normalizePath(basePath);

        // The exclude spec list is converted into a regular expression, which allows us to quickly
        // test whether a file or directory should be excluded before recursively traversing the
        // file system.
        const keyMapper = host.useCaseSensitiveFileNames ? caseSensitiveKeyMapper : caseInsensitiveKeyMapper;

        // Literal file names (provided via the "files" array in tsconfig.json) are stored in a
        // file map with a possibly case insensitive key. We use this map later when when including
        // wildcard paths.
        const literalFileMap = createMap<string>();

        // Wildcard paths (provided via the "includes" array in tsconfig.json) are stored in a
        // file map with a possibly case insensitive key. We use this map to store paths matched
        // via wildcard, and to handle extension priority.
        const wildcardFileMap = createMap<string>();

        if (include) {
            include = validateSpecs(include, errors, /*allowTrailingRecursion*/ false);
        }

        if (exclude) {
            exclude = validateSpecs(exclude, errors, /*allowTrailingRecursion*/ true);
        }

        // Wildcard directories (provided as part of a wildcard path) are stored in a
        // file map that marks whether it was a regular wildcard match (with a `*` or `?` token),
        // or a recursive directory. This information is used by filesystem watchers to monitor for
        // new entries in these paths.
        const wildcardDirectories: Map<WatchDirectoryFlags> = getWildcardDirectories(include, exclude, basePath, host.useCaseSensitiveFileNames);

        // Rather than requery this for each file and filespec, we query the supported extensions
        // once and store it on the expansion context.
        const supportedExtensions = getSupportedExtensions(options, extraFileExtensions);

        // Literal files are always included verbatim. An "include" or "exclude" specification cannot
        // remove a literal file.
        if (fileNames) {
            for (const fileName of fileNames) {
                const file = combinePaths(basePath, fileName);
                literalFileMap[keyMapper(file)] = file;
            }
        }

        if (include && include.length > 0) {
            for (const file of host.readDirectory(basePath, supportedExtensions, exclude, include)) {
                // If we have already included a literal or wildcard path with a
                // higher priority extension, we should skip this file.
                //
                // This handles cases where we may encounter both <file>.ts and
                // <file>.d.ts (or <file>.js if "allowJs" is enabled) in the same
                // directory when they are compilation outputs.
                if (hasFileWithHigherPriorityExtension(file, literalFileMap, wildcardFileMap, supportedExtensions, keyMapper)) {
                    continue;
                }

                // We may have included a wildcard path with a lower priority
                // extension due to the user-defined order of entries in the
                // "include" array. If there is a lower priority extension in the
                // same directory, we should remove it.
                removeWildcardFilesWithLowerPriorityExtension(file, wildcardFileMap, supportedExtensions, keyMapper);

                const key = keyMapper(file);
                if (!(key in literalFileMap) && !(key in wildcardFileMap)) {
                    wildcardFileMap[key] = file;
                }
            }
        }

        const literalFiles = reduceProperties(literalFileMap, addFileToOutput, []);
        const wildcardFiles = reduceProperties(wildcardFileMap, addFileToOutput, []);
        wildcardFiles.sort(host.useCaseSensitiveFileNames ? compareStrings : compareStringsCaseInsensitive);
        return {
            fileNames: literalFiles.concat(wildcardFiles),
            wildcardDirectories
        };
    }

    function validateSpecs(specs: string[], errors: Diagnostic[], allowTrailingRecursion: boolean) {
        const validSpecs: string[] = [];
        for (const spec of specs) {
            if (!allowTrailingRecursion && invalidTrailingRecursionPattern.test(spec)) {
                errors.push(createCompilerDiagnostic(Diagnostics.File_specification_cannot_end_in_a_recursive_directory_wildcard_Asterisk_Asterisk_Colon_0, spec));
            }
            else if (invalidMultipleRecursionPatterns.test(spec)) {
                errors.push(createCompilerDiagnostic(Diagnostics.File_specification_cannot_contain_multiple_recursive_directory_wildcards_Asterisk_Asterisk_Colon_0, spec));
            }
            else if (invalidDotDotAfterRecursiveWildcardPattern.test(spec)) {
                errors.push(createCompilerDiagnostic(Diagnostics.File_specification_cannot_contain_a_parent_directory_that_appears_after_a_recursive_directory_wildcard_Asterisk_Asterisk_Colon_0, spec));
            }
            else {
                validSpecs.push(spec);
            }
        }

        return validSpecs;
    }

    /**
     * Gets directories in a set of include patterns that should be watched for changes.
     */
    function getWildcardDirectories(include: string[], exclude: string[], path: string, useCaseSensitiveFileNames: boolean): Map<WatchDirectoryFlags> {
        // We watch a directory recursively if it contains a wildcard anywhere in a directory segment
        // of the pattern:
        //
        //  /a/b/**/d   - Watch /a/b recursively to catch changes to any d in any subfolder recursively
        //  /a/b/*/d    - Watch /a/b recursively to catch any d in any immediate subfolder, even if a new subfolder is added
        //  /a/b        - Watch /a/b recursively to catch changes to anything in any recursive subfoler
        //
        // We watch a directory without recursion if it contains a wildcard in the file segment of
        // the pattern:
        //
        //  /a/b/*      - Watch /a/b directly to catch any new file
        //  /a/b/a?z    - Watch /a/b directly to catch any new file matching a?z
        const rawExcludeRegex = getRegularExpressionForWildcard(exclude, path, "exclude");
        const excludeRegex = rawExcludeRegex && new RegExp(rawExcludeRegex, useCaseSensitiveFileNames ? "" : "i");
        const wildcardDirectories = createMap<WatchDirectoryFlags>();
        if (include !== undefined) {
            const recursiveKeys: string[] = [];
            for (const file of include) {
                const spec = normalizePath(combinePaths(path, file));
                if (excludeRegex && excludeRegex.test(spec)) {
                    continue;
                }

                const match = getWildcardDirectoryFromSpec(spec, useCaseSensitiveFileNames);
                if (match) {
                    const { key, flags } = match;
                    const existingFlags = wildcardDirectories[key];
                    if (existingFlags === undefined || existingFlags < flags) {
                        wildcardDirectories[key] = flags;
                        if (flags === WatchDirectoryFlags.Recursive) {
                            recursiveKeys.push(key);
                        }
                    }
                }
            }

            // Remove any subpaths under an existing recursively watched directory.
            for (const key in wildcardDirectories) {
                for (const recursiveKey of recursiveKeys) {
                    if (key !== recursiveKey && containsPath(recursiveKey, key, path, !useCaseSensitiveFileNames)) {
                        delete wildcardDirectories[key];
                    }
                }
            }
        }

        return wildcardDirectories;
    }

    function getWildcardDirectoryFromSpec(spec: string, useCaseSensitiveFileNames: boolean): { key: string, flags: WatchDirectoryFlags } | undefined {
        const match = wildcardDirectoryPattern.exec(spec);
        if (match) {
            return {
                key: useCaseSensitiveFileNames ? match[0] : match[0].toLowerCase(),
                flags: watchRecursivePattern.test(spec) ? WatchDirectoryFlags.Recursive : WatchDirectoryFlags.None
            };
        }
        if (isImplicitGlob(spec)) {
            return { key: spec, flags: WatchDirectoryFlags.Recursive };
        }
        return undefined;
    }

    /**
     * Determines whether a literal or wildcard file has already been included that has a higher
     * extension priority.
     *
     * @param file The path to the file.
     * @param extensionPriority The priority of the extension.
     * @param context The expansion context.
     */
    function hasFileWithHigherPriorityExtension(file: string, literalFiles: Map<string>, wildcardFiles: Map<string>, extensions: string[], keyMapper: (value: string) => string) {
        const extensionPriority = getExtensionPriority(file, extensions);
        const adjustedExtensionPriority = adjustExtensionPriority(extensionPriority);
        for (let i = ExtensionPriority.Highest; i < adjustedExtensionPriority; i++) {
            const higherPriorityExtension = extensions[i];
            const higherPriorityPath = keyMapper(changeExtension(file, higherPriorityExtension));
            if (higherPriorityPath in literalFiles || higherPriorityPath in wildcardFiles) {
                return true;
            }
        }

        return false;
    }

    /**
     * Removes files included via wildcard expansion with a lower extension priority that have
     * already been included.
     *
     * @param file The path to the file.
     * @param extensionPriority The priority of the extension.
     * @param context The expansion context.
     */
    function removeWildcardFilesWithLowerPriorityExtension(file: string, wildcardFiles: Map<string>, extensions: string[], keyMapper: (value: string) => string) {
        const extensionPriority = getExtensionPriority(file, extensions);
        const nextExtensionPriority = getNextLowestExtensionPriority(extensionPriority);
        for (let i = nextExtensionPriority; i < extensions.length; i++) {
            const lowerPriorityExtension = extensions[i];
            const lowerPriorityPath = keyMapper(changeExtension(file, lowerPriorityExtension));
            delete wildcardFiles[lowerPriorityPath];
        }
    }

    /**
     * Adds a file to an array of files.
     *
     * @param output The output array.
     * @param file The file path.
     */
    function addFileToOutput(output: string[], file: string) {
        output.push(file);
        return output;
    }

    /**
     * Gets a case sensitive key.
     *
     * @param key The original key.
     */
    function caseSensitiveKeyMapper(key: string) {
        return key;
    }

    /**
     * Gets a case insensitive key.
     *
     * @param key The original key.
     */
    function caseInsensitiveKeyMapper(key: string) {
        return key.toLowerCase();
    }
}
