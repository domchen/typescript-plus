/// <reference path="core.ts"/>

declare function setTimeout(handler: (...args: any[]) => void, timeout: number): any;
declare function clearTimeout(handle: any): void;

namespace ts {
    /**
     * Set a high stack trace limit to provide more information in case of an error.
     * Called for command-line and server use cases.
     * Not called if TypeScript is used as a library.
     */
    /* @internal */
    export function setStackTraceLimit() {
        if ((Error as any).stackTraceLimit < 100) { // Also tests that we won't set the property if it doesn't exist.
            (Error as any).stackTraceLimit = 100;
        }
    }

    export enum FileWatcherEventKind {
        Created,
        Changed,
        Deleted
    }

    export type FileWatcherCallback = (fileName: string, eventKind: FileWatcherEventKind) => void;
    export type DirectoryWatcherCallback = (fileName: string) => void;
    export interface WatchedFile {
        fileName: string;
        callback: FileWatcherCallback;
        mtime?: Date;
    }

    export interface System {
        args: string[];
        newLine: string;
        useCaseSensitiveFileNames: boolean;
        write(s: string): void;
        readFile(path: string, encoding?: string): string | undefined;
        getFileSize?(path: string): number;
        writeFile(path: string, data: string, writeByteOrderMark?: boolean): void;
        /**
         * @pollingInterval - this parameter is used in polling-based watchers and ignored in watchers that
         * use native OS file watching
         */
        watchFile?(path: string, callback: FileWatcherCallback, pollingInterval?: number): FileWatcher;
        watchDirectory?(path: string, callback: DirectoryWatcherCallback, recursive?: boolean): FileWatcher;
        resolvePath(path: string): string;
        fileExists(path: string): boolean;
        directoryExists(path: string): boolean;
        createDirectory(path: string): void;
        getExecutingFilePath(): string;
        getCurrentDirectory(): string;
        getDirectories(path: string): string[];
        readDirectory(path: string, extensions?: ReadonlyArray<string>, exclude?: ReadonlyArray<string>, include?: ReadonlyArray<string>, depth?: number): string[];
        getModifiedTime?(path: string): Date;
        /**
         * This should be cryptographically secure.
         * A good implementation is node.js' `crypto.createHash`. (https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm)
         */
        createHash?(data: string): string;
        getMemoryUsage?(): number;
        exit(exitCode?: number): void;
        realpath?(path: string): string;
        /*@internal*/ getEnvironmentVariable(name: string): string;
        /*@internal*/ tryEnableSourceMapsForHost?(): void;
        /*@internal*/ debugMode?: boolean;
        setTimeout?(callback: (...args: any[]) => void, ms: number, ...args: any[]): any;
        clearTimeout?(timeoutId: any): void;
        clearScreen?(): void;
    }

    export interface FileWatcher {
        close(): void;
    }

    interface DirectoryWatcher extends FileWatcher {
        referenceCount: number;
    }

    declare const require: any;
    declare const process: any;
    declare const global: any;
    declare const __filename: string;

    export function getNodeMajorVersion() {
        if (typeof process === "undefined") {
            return undefined;
        }
        const version: string = process.version;
        if (!version) {
            return undefined;
        }
        const dot = version.indexOf(".");
        if (dot === -1) {
            return undefined;
        }
        return parseInt(version.substring(1, dot));
    }

    declare const ChakraHost: {
        args: string[];
        currentDirectory: string;
        executingFile: string;
        newLine?: string;
        useCaseSensitiveFileNames?: boolean;
        echo(s: string): void;
        quit(exitCode?: number): void;
        fileExists(path: string): boolean;
        directoryExists(path: string): boolean;
        createDirectory(path: string): void;
        resolvePath(path: string): string;
        readFile(path: string): string | undefined;
        writeFile(path: string, contents: string): void;
        getDirectories(path: string): string[];
        readDirectory(path: string, extensions?: ReadonlyArray<string>, basePaths?: ReadonlyArray<string>, excludeEx?: string, includeFileEx?: string, includeDirEx?: string): string[];
        watchFile?(path: string, callback: FileWatcherCallback): FileWatcher;
        watchDirectory?(path: string, callback: DirectoryWatcherCallback, recursive?: boolean): FileWatcher;
        realpath(path: string): string;
        getEnvironmentVariable?(name: string): string;
    };

    export let sys: System = (() => {
        // NodeJS detects "\uFEFF" at the start of the string and *replaces* it with the actual
        // byte order mark from the specified encoding. Using any other byte order mark does
        // not actually work.
        const byteOrderMarkIndicator = "\uFEFF";

        function getNodeSystem(): System {
            const _fs = require("fs");
            const _path = require("path");
            const _os = require("os");
            const _crypto = require("crypto");

            const useNonPollingWatchers = process.env.TSC_NONPOLLING_WATCHER;

            function createWatchedFileSet() {
                const dirWatchers = createMap<DirectoryWatcher>();
                // One file can have multiple watchers
                const fileWatcherCallbacks = createMultiMap<FileWatcherCallback>();
                return { addFile, removeFile };

                function reduceDirWatcherRefCountForFile(fileName: string) {
                    const dirName = getDirectoryPath(fileName);
                    const watcher = dirWatchers.get(dirName);
                    if (watcher) {
                        watcher.referenceCount -= 1;
                        if (watcher.referenceCount <= 0) {
                            watcher.close();
                            dirWatchers.delete(dirName);
                        }
                    }
                }

                function addDirWatcher(dirPath: string): void {
                    let watcher = dirWatchers.get(dirPath);
                    if (watcher) {
                        watcher.referenceCount += 1;
                        return;
                    }
                    watcher = fsWatchDirectory(
                        dirPath || ".",
                        (eventName: string, relativeFileName: string) => fileEventHandler(eventName, relativeFileName, dirPath)
                    ) as DirectoryWatcher;
                    watcher.referenceCount = 1;
                    dirWatchers.set(dirPath, watcher);
                    return;
                }

                function addFileWatcherCallback(filePath: string, callback: FileWatcherCallback): void {
                    fileWatcherCallbacks.add(filePath, callback);
                }

                function addFile(fileName: string, callback: FileWatcherCallback): WatchedFile {
                    addFileWatcherCallback(fileName, callback);
                    addDirWatcher(getDirectoryPath(fileName));

                    return { fileName, callback };
                }

                function removeFile(watchedFile: WatchedFile) {
                    removeFileWatcherCallback(watchedFile.fileName, watchedFile.callback);
                    reduceDirWatcherRefCountForFile(watchedFile.fileName);
                }

                function removeFileWatcherCallback(filePath: string, callback: FileWatcherCallback) {
                    fileWatcherCallbacks.remove(filePath, callback);
                }

                function fileEventHandler(eventName: string, relativeFileName: string | undefined, baseDirPath: string) {
                    // When files are deleted from disk, the triggered "rename" event would have a relativefileName of "undefined"
                    const fileName = !isString(relativeFileName)
                        ? undefined
                        : ts.getNormalizedAbsolutePath(relativeFileName, baseDirPath);
                    // Some applications save a working file via rename operations
                    if ((eventName === "change" || eventName === "rename")) {
                        const callbacks = fileWatcherCallbacks.get(fileName);
                        if (callbacks) {
                            for (const fileCallback of callbacks) {
                                fileCallback(fileName, FileWatcherEventKind.Changed);
                            }
                        }
                    }
                }
            }
            const watchedFileSet = createWatchedFileSet();

            const nodeVersion = getNodeMajorVersion();
            const isNode4OrLater = nodeVersion >= 4;

            function isFileSystemCaseSensitive(): boolean {
                // win32\win64 are case insensitive platforms
                if (platform === "win32" || platform === "win64") {
                    return false;
                }
                // If this file exists under a different case, we must be case-insensitve.
                return !fileExists(swapCase(__filename));
            }

            /** Convert all lowercase chars to uppercase, and vice-versa */
            function swapCase(s: string): string {
                return s.replace(/\w/g, (ch) => {
                    const up = ch.toUpperCase();
                    return ch === up ? ch.toLowerCase() : up;
                });
            }

            const platform: string = _os.platform();
            const useCaseSensitiveFileNames = isFileSystemCaseSensitive();

            function fsWatchFile(fileName: string, callback: FileWatcherCallback, pollingInterval?: number): FileWatcher {
                _fs.watchFile(fileName, { persistent: true, interval: pollingInterval || 250 }, fileChanged);
                return {
                    close: () => _fs.unwatchFile(fileName, fileChanged)
                };

                function fileChanged(curr: any, prev: any) {
                    const isCurrZero = +curr.mtime === 0;
                    const isPrevZero = +prev.mtime === 0;
                    const created = !isCurrZero && isPrevZero;
                    const deleted = isCurrZero && !isPrevZero;

                    const eventKind = created
                        ? FileWatcherEventKind.Created
                        : deleted
                            ? FileWatcherEventKind.Deleted
                            : FileWatcherEventKind.Changed;

                    if (eventKind === FileWatcherEventKind.Changed && +curr.mtime <= +prev.mtime) {
                        return;
                    }

                    callback(fileName, eventKind);
                }
            }

            function fsWatchDirectory(directoryName: string, callback: (eventName: string, relativeFileName: string) => void, recursive?: boolean): FileWatcher {
                let options: any;
                /** Watcher for the directory depending on whether it is missing or present */
                let watcher = !directoryExists(directoryName) ?
                    watchMissingDirectory() :
                    watchPresentDirectory();
                return {
                    close: () => {
                        // Close the watcher (either existing directory watcher or missing directory watcher)
                        watcher.close();
                    }
                };

                /**
                 * Watch the directory that is currently present
                 * and when the watched directory is deleted, switch to missing directory watcher
                 */
                function watchPresentDirectory(): FileWatcher {
                    // Node 4.0 `fs.watch` function supports the "recursive" option on both OSX and Windows
                    // (ref: https://github.com/nodejs/node/pull/2649 and https://github.com/Microsoft/TypeScript/issues/4643)
                    if (options === undefined) {
                        if (isNode4OrLater && (process.platform === "win32" || process.platform === "darwin")) {
                            options = { persistent: true, recursive: !!recursive };
                        }
                        else {
                            options = { persistent: true };
                        }
                    }

                    const dirWatcher = _fs.watch(
                        directoryName,
                        options,
                        callback
                    );
                    dirWatcher.on("error", () => {
                        if (!directoryExists(directoryName)) {
                            // Deleting directory
                            watcher = watchMissingDirectory();
                            // Call the callback for current directory
                            callback("rename", "");
                        }
                    });
                    return dirWatcher;
                }

                /**
                 * Watch the directory that is missing
                 * and switch to existing directory when the directory is created
                 */
                function watchMissingDirectory(): FileWatcher {
                    return fsWatchFile(directoryName, (_fileName, eventKind) => {
                        if (eventKind === FileWatcherEventKind.Created && directoryExists(directoryName)) {
                            watcher.close();
                            watcher = watchPresentDirectory();
                            // Call the callback for current directory
                            // For now it could be callback for the inner directory creation,
                            // but just return current directory, better than current no-op
                            callback("rename", "");
                        }
                    });
                }
            }

            function readFile(fileName: string, _encoding?: string): string | undefined {
                if (!fileExists(fileName)) {
                    return undefined;
                }
                const buffer = _fs.readFileSync(fileName);
                let len = buffer.length;
                if (len >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
                    // Big endian UTF-16 byte order mark detected. Since big endian is not supported by node.js,
                    // flip all byte pairs and treat as little endian.
                    len &= ~1; // Round down to a multiple of 2
                    for (let i = 0; i < len; i += 2) {
                        const temp = buffer[i];
                        buffer[i] = buffer[i + 1];
                        buffer[i + 1] = temp;
                    }
                    return buffer.toString("utf16le", 2);
                }
                if (len >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
                    // Little endian UTF-16 byte order mark detected
                    return buffer.toString("utf16le", 2);
                }
                if (len >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
                    // UTF-8 byte order mark detected
                    return buffer.toString("utf8", 3);
                }
                // Default is UTF-8 with no byte order mark
                return buffer.toString("utf8");
            }

            function writeFile(fileName: string, data: string, writeByteOrderMark?: boolean): void {
                // If a BOM is required, emit one
                if (writeByteOrderMark) {
                    data = byteOrderMarkIndicator + data;
                }

                let fd: number;

                try {
                    fd = _fs.openSync(fileName, "w");
                    _fs.writeSync(fd, data, /*position*/ undefined, "utf8");
                }
                finally {
                    if (fd !== undefined) {
                        _fs.closeSync(fd);
                    }
                }
            }

            function getAccessibleFileSystemEntries(path: string): FileSystemEntries {
                try {
                    const entries = _fs.readdirSync(path || ".").sort();
                    const files: string[] = [];
                    const directories: string[] = [];
                    for (const entry of entries) {
                        // This is necessary because on some file system node fails to exclude
                        // "." and "..". See https://github.com/nodejs/node/issues/4002
                        if (entry === "." || entry === "..") {
                            continue;
                        }
                        const name = combinePaths(path, entry);

                        let stat: any;
                        try {
                            stat = _fs.statSync(name);
                        }
                        catch (e) {
                            continue;
                        }

                        if (stat.isFile()) {
                            files.push(entry);
                        }
                        else if (stat.isDirectory()) {
                            directories.push(entry);
                        }
                    }
                    return { files, directories };
                }
                catch (e) {
                    return emptyFileSystemEntries;
                }
            }

            function readDirectory(path: string, extensions?: ReadonlyArray<string>, excludes?: ReadonlyArray<string>, includes?: ReadonlyArray<string>, depth?: number): string[] {
                return matchFiles(path, extensions, excludes, includes, useCaseSensitiveFileNames, process.cwd(), depth, getAccessibleFileSystemEntries);
            }

            const enum FileSystemEntryKind {
                File,
                Directory
            }

            function fileSystemEntryExists(path: string, entryKind: FileSystemEntryKind): boolean {
                try {
                    const stat = _fs.statSync(path);
                    switch (entryKind) {
                        case FileSystemEntryKind.File: return stat.isFile();
                        case FileSystemEntryKind.Directory: return stat.isDirectory();
                    }
                }
                catch (e) {
                    return false;
                }
            }

            function fileExists(path: string): boolean {
                return fileSystemEntryExists(path, FileSystemEntryKind.File);
            }

            function directoryExists(path: string): boolean {
                return fileSystemEntryExists(path, FileSystemEntryKind.Directory);
            }

            function getDirectories(path: string): string[] {
                return filter<string>(_fs.readdirSync(path), dir => fileSystemEntryExists(combinePaths(path, dir), FileSystemEntryKind.Directory));
            }

            const nodeSystem: System = {
                clearScreen: () => {
                    process.stdout.write("\x1Bc");
                },
                args: process.argv.slice(2),
                newLine: _os.EOL,
                useCaseSensitiveFileNames,
                write(s: string): void {
                    process.stdout.write(s);
                },
                readFile,
                writeFile,
                watchFile: (fileName, callback, pollingInterval) => {
                    if (useNonPollingWatchers) {
                        const watchedFile = watchedFileSet.addFile(fileName, callback);
                        return {
                            close: () => watchedFileSet.removeFile(watchedFile)
                        };
                    }
                    else {
                        return fsWatchFile(fileName, callback, pollingInterval);
                    }
                },
                watchDirectory: (directoryName, callback, recursive) => {
                    // Node 4.0 `fs.watch` function supports the "recursive" option on both OSX and Windows
                    // (ref: https://github.com/nodejs/node/pull/2649 and https://github.com/Microsoft/TypeScript/issues/4643)
                    return fsWatchDirectory(directoryName, (eventName, relativeFileName) => {
                        // In watchDirectory we only care about adding and removing files (when event name is
                        // "rename"); changes made within files are handled by corresponding fileWatchers (when
                        // event name is "change")
                        if (eventName === "rename") {
                            // When deleting a file, the passed baseFileName is null
                            callback(!relativeFileName ? relativeFileName : normalizePath(combinePaths(directoryName, relativeFileName)));
                        }
                    }, recursive);
                },
                resolvePath: path => _path.resolve(path),
                fileExists,
                directoryExists,
                createDirectory(directoryName: string) {
                    if (!nodeSystem.directoryExists(directoryName)) {
                        _fs.mkdirSync(directoryName);
                    }
                },
                getExecutingFilePath() {
                    return __filename;
                },
                getCurrentDirectory() {
                    return process.cwd();
                },
                getDirectories,
                getEnvironmentVariable(name: string) {
                    return process.env[name] || "";
                },
                readDirectory,
                getModifiedTime(path) {
                    try {
                        return _fs.statSync(path).mtime;
                    }
                    catch (e) {
                        return undefined;
                    }
                },
                createHash(data) {
                    const hash = _crypto.createHash("md5");
                    hash.update(data);
                    return hash.digest("hex");
                },
                getMemoryUsage() {
                    if (global.gc) {
                        global.gc();
                    }
                    return process.memoryUsage().heapUsed;
                },
                getFileSize(path) {
                    try {
                        const stat = _fs.statSync(path);
                        if (stat.isFile()) {
                            return stat.size;
                        }
                    }
                    catch { /*ignore*/ }
                    return 0;
                },
                exit(exitCode?: number): void {
                    process.exit(exitCode);
                },
                realpath(path: string): string {
                    try {
                        return _fs.realpathSync(path);
                    }
                    catch {
                        return path;
                    }
                },
                debugMode: some(<string[]>process.execArgv, arg => /^--(inspect|debug)(-brk)?(=\d+)?$/i.test(arg)),
                tryEnableSourceMapsForHost() {
                    try {
                        require("source-map-support").install();
                    }
                    catch {
                        // Could not enable source maps.
                    }
                },
                setTimeout,
                clearTimeout
            };
            return nodeSystem;
        }

        function getChakraSystem(): System {
            const realpath = ChakraHost.realpath && ((path: string) => ChakraHost.realpath(path));
            return {
                newLine: ChakraHost.newLine || "\r\n",
                args: ChakraHost.args,
                useCaseSensitiveFileNames: !!ChakraHost.useCaseSensitiveFileNames,
                write: ChakraHost.echo,
                readFile(path: string, _encoding?: string) {
                    // encoding is automatically handled by the implementation in ChakraHost
                    return ChakraHost.readFile(path);
                },
                writeFile(path: string, data: string, writeByteOrderMark?: boolean) {
                    // If a BOM is required, emit one
                    if (writeByteOrderMark) {
                        data = byteOrderMarkIndicator + data;
                    }

                    ChakraHost.writeFile(path, data);
                },
                resolvePath: ChakraHost.resolvePath,
                fileExists: ChakraHost.fileExists,
                directoryExists: ChakraHost.directoryExists,
                createDirectory: ChakraHost.createDirectory,
                getExecutingFilePath: () => ChakraHost.executingFile,
                getCurrentDirectory: () => ChakraHost.currentDirectory,
                getDirectories: ChakraHost.getDirectories,
                getEnvironmentVariable: ChakraHost.getEnvironmentVariable || (() => ""),
                readDirectory(path, extensions, excludes, includes, _depth) {
                    const pattern = getFileMatcherPatterns(path, excludes, includes, !!ChakraHost.useCaseSensitiveFileNames, ChakraHost.currentDirectory);
                    return ChakraHost.readDirectory(path, extensions, pattern.basePaths, pattern.excludePattern, pattern.includeFilePattern, pattern.includeDirectoryPattern);
                },
                exit: ChakraHost.quit,
                realpath
            };
        }

        function recursiveCreateDirectory(directoryPath: string, sys: System) {
            const basePath = getDirectoryPath(directoryPath);
            const shouldCreateParent = basePath !== "" && directoryPath !== basePath && !sys.directoryExists(basePath);
            if (shouldCreateParent) {
                recursiveCreateDirectory(basePath, sys);
            }
            if (shouldCreateParent || !sys.directoryExists(directoryPath)) {
                sys.createDirectory(directoryPath);
            }
        }

        let sys: System;
        if (typeof ChakraHost !== "undefined") {
            sys = getChakraSystem();
        }
        else if (typeof process !== "undefined" && process.nextTick && !process.browser && typeof require !== "undefined") {
            // process and process.nextTick checks if current environment is node-like
            // process.browser check excludes webpack and browserify
            sys = getNodeSystem();
        }
        if (sys) {
            // patch writefile to create folder before writing the file
            const originalWriteFile = sys.writeFile;
            sys.writeFile = (path, data, writeBom) => {
                const directoryPath = getDirectoryPath(normalizeSlashes(path));
                if (directoryPath && !sys.directoryExists(directoryPath)) {
                    recursiveCreateDirectory(directoryPath, sys);
                }
                originalWriteFile.call(sys, path, data, writeBom);
            };
        }
        return sys;
    })();

    if (sys && sys.getEnvironmentVariable) {
        Debug.currentAssertionLevel = /^development$/i.test(sys.getEnvironmentVariable("NODE_ENV"))
            ? AssertionLevel.Normal
            : AssertionLevel.None;
    }
    if (sys && sys.debugMode) {
        Debug.isDebugging = true;
    }
}
