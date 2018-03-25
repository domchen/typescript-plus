/// <reference path="types.ts"/>
/// <reference path="core.ts"/>
/// <reference path="watchUtilities.ts"/>

/*@internal*/
namespace ts {
    /** This is the cache of module/typedirectives resolution that can be retained across program */
    export interface ResolutionCache {
        startRecordingFilesWithChangedResolutions(): void;
        finishRecordingFilesWithChangedResolutions(): Path[];

        resolveModuleNames(moduleNames: string[], containingFile: string, reusedNames: string[] | undefined): ResolvedModuleFull[];
        resolveTypeReferenceDirectives(typeDirectiveNames: string[], containingFile: string): ResolvedTypeReferenceDirective[];

        invalidateResolutionOfFile(filePath: Path): void;
        removeResolutionsOfFile(filePath: Path): void;
        createHasInvalidatedResolution(forceAllFilesAsInvalidated?: boolean): HasInvalidatedResolution;

        startCachingPerDirectoryResolution(): void;
        finishCachingPerDirectoryResolution(): void;

        updateTypeRootsWatch(): void;
        closeTypeRootsWatch(): void;

        clear(): void;
    }

    interface ResolutionWithFailedLookupLocations {
        readonly failedLookupLocations: ReadonlyArray<string>;
        isInvalidated?: boolean;
    }

    interface ResolutionWithResolvedFileName {
        resolvedFileName: string | undefined;
    }

    interface ResolvedModuleWithFailedLookupLocations extends ts.ResolvedModuleWithFailedLookupLocations, ResolutionWithFailedLookupLocations {
    }

    interface ResolvedTypeReferenceDirectiveWithFailedLookupLocations extends ts.ResolvedTypeReferenceDirectiveWithFailedLookupLocations, ResolutionWithFailedLookupLocations {
    }

    export interface ResolutionCacheHost extends ModuleResolutionHost {
        toPath(fileName: string): Path;
        getCompilationSettings(): CompilerOptions;
        watchDirectoryOfFailedLookupLocation(directory: string, cb: DirectoryWatcherCallback, flags: WatchDirectoryFlags): FileWatcher;
        onInvalidatedResolution(): void;
        watchTypeRootsDirectory(directory: string, cb: DirectoryWatcherCallback, flags: WatchDirectoryFlags): FileWatcher;
        onChangedAutomaticTypeDirectiveNames(): void;
        getCachedDirectoryStructureHost(): CachedDirectoryStructureHost | undefined;
        projectName?: string;
        getGlobalCache?(): string | undefined;
        writeLog(s: string): void;
        maxNumberOfFilesToIterateForInvalidation?: number;
        getCurrentProgram(): Program;
    }

    interface DirectoryWatchesOfFailedLookup {
        /** watcher for the directory of failed lookup */
        watcher: FileWatcher;
        /** ref count keeping this directory watch alive */
        refCount: number;
    }

    interface DirectoryOfFailedLookupWatch {
        dir: string;
        dirPath: Path;
        ignore?: true;
    }

    export const maxNumberOfFilesToIterateForInvalidation = 256;

    type GetResolutionWithResolvedFileName<T extends ResolutionWithFailedLookupLocations = ResolutionWithFailedLookupLocations, R extends ResolutionWithResolvedFileName = ResolutionWithResolvedFileName> =
        (resolution: T) => R;

    export function createResolutionCache(resolutionHost: ResolutionCacheHost, rootDirForResolution: string, logChangesWhenResolvingModule: boolean): ResolutionCache {
        let filesWithChangedSetOfUnresolvedImports: Path[] | undefined;
        let filesWithInvalidatedResolutions: Map<true> | undefined;
        let allFilesHaveInvalidatedResolution = false;

        // The resolvedModuleNames and resolvedTypeReferenceDirectives are the cache of resolutions per file.
        // The key in the map is source file's path.
        // The values are Map of resolutions with key being name lookedup.
        const resolvedModuleNames = createMap<Map<ResolvedModuleWithFailedLookupLocations>>();
        const perDirectoryResolvedModuleNames = createMap<Map<ResolvedModuleWithFailedLookupLocations>>();

        const resolvedTypeReferenceDirectives = createMap<Map<ResolvedTypeReferenceDirectiveWithFailedLookupLocations>>();
        const perDirectoryResolvedTypeReferenceDirectives = createMap<Map<ResolvedTypeReferenceDirectiveWithFailedLookupLocations>>();

        const getCurrentDirectory = memoize(() => resolutionHost.getCurrentDirectory());
        const cachedDirectoryStructureHost = resolutionHost.getCachedDirectoryStructureHost();

        /**
         * These are the extensions that failed lookup files will have by default,
         * any other extension of failed lookup will be store that path in custom failed lookup path
         * This helps in not having to comb through all resolutions when files are added/removed
         * Note that .d.ts file also has .d.ts extension hence will be part of default extensions
         */
        const failedLookupDefaultExtensions = [Extension.Ts, Extension.Tsx, Extension.Js, Extension.Jsx, Extension.Json];
        const customFailedLookupPaths = createMap<number>();

        const directoryWatchesOfFailedLookups = createMap<DirectoryWatchesOfFailedLookup>();
        const rootDir = rootDirForResolution && removeTrailingDirectorySeparator(getNormalizedAbsolutePath(rootDirForResolution, getCurrentDirectory()));
        const rootPath = rootDir && resolutionHost.toPath(rootDir);

        // TypeRoot watches for the types that get added as part of getAutomaticTypeDirectiveNames
        const typeRootsWatches = createMap<FileWatcher>();

        return {
            startRecordingFilesWithChangedResolutions,
            finishRecordingFilesWithChangedResolutions,
            // perDirectoryResolvedModuleNames and perDirectoryResolvedTypeReferenceDirectives could be non empty if there was exception during program update
            // (between startCachingPerDirectoryResolution and finishCachingPerDirectoryResolution)
            startCachingPerDirectoryResolution: clearPerDirectoryResolutions,
            finishCachingPerDirectoryResolution,
            resolveModuleNames,
            resolveTypeReferenceDirectives,
            removeResolutionsOfFile,
            invalidateResolutionOfFile,
            createHasInvalidatedResolution,
            updateTypeRootsWatch,
            closeTypeRootsWatch,
            clear
        };

        function getResolvedModule(resolution: ResolvedModuleWithFailedLookupLocations) {
            return resolution.resolvedModule;
        }

        function getResolvedTypeReferenceDirective(resolution: ResolvedTypeReferenceDirectiveWithFailedLookupLocations) {
            return resolution.resolvedTypeReferenceDirective;
        }

        function isInDirectoryPath(dir: Path, file: Path) {
            if (dir === undefined || file.length <= dir.length) {
                return false;
            }
            return startsWith(file, dir) && file[dir.length] === directorySeparator;
        }

        function clear() {
            clearMap(directoryWatchesOfFailedLookups, closeFileWatcherOf);
            customFailedLookupPaths.clear();
            closeTypeRootsWatch();
            resolvedModuleNames.clear();
            resolvedTypeReferenceDirectives.clear();
            allFilesHaveInvalidatedResolution = false;
            // perDirectoryResolvedModuleNames and perDirectoryResolvedTypeReferenceDirectives could be non empty if there was exception during program update
            // (between startCachingPerDirectoryResolution and finishCachingPerDirectoryResolution)
            clearPerDirectoryResolutions();
        }

        function startRecordingFilesWithChangedResolutions() {
            filesWithChangedSetOfUnresolvedImports = [];
        }

        function finishRecordingFilesWithChangedResolutions() {
            const collected = filesWithChangedSetOfUnresolvedImports;
            filesWithChangedSetOfUnresolvedImports = undefined;
            return collected;
        }

        function createHasInvalidatedResolution(forceAllFilesAsInvalidated?: boolean): HasInvalidatedResolution {
            if (allFilesHaveInvalidatedResolution || forceAllFilesAsInvalidated) {
                // Any file asked would have invalidated resolution
                filesWithInvalidatedResolutions = undefined;
                return returnTrue;
            }
            const collected = filesWithInvalidatedResolutions;
            filesWithInvalidatedResolutions = undefined;
            return path => collected && collected.has(path);
        }

        function clearPerDirectoryResolutions() {
            perDirectoryResolvedModuleNames.clear();
            perDirectoryResolvedTypeReferenceDirectives.clear();
        }

        function finishCachingPerDirectoryResolution() {
            allFilesHaveInvalidatedResolution = false;
            directoryWatchesOfFailedLookups.forEach((watcher, path) => {
                if (watcher.refCount === 0) {
                    directoryWatchesOfFailedLookups.delete(path);
                    watcher.watcher.close();
                }
            });

            clearPerDirectoryResolutions();
        }

        function resolveModuleName(moduleName: string, containingFile: string, compilerOptions: CompilerOptions, host: ModuleResolutionHost): ResolvedModuleWithFailedLookupLocations {
            const primaryResult = ts.resolveModuleName(moduleName, containingFile, compilerOptions, host);
            // return result immediately only if global cache support is not enabled or if it is .ts, .tsx or .d.ts
            if (!resolutionHost.getGlobalCache) {
                return primaryResult;
            }

            // otherwise try to load typings from @types
            const globalCache = resolutionHost.getGlobalCache();
            if (globalCache !== undefined && !isExternalModuleNameRelative(moduleName) && !(primaryResult.resolvedModule && extensionIsTypeScript(primaryResult.resolvedModule.extension))) {
                // create different collection of failed lookup locations for second pass
                // if it will fail and we've already found something during the first pass - we don't want to pollute its results
                const { resolvedModule, failedLookupLocations } = loadModuleFromGlobalCache(moduleName, resolutionHost.projectName, compilerOptions, host, globalCache);
                if (resolvedModule) {
                    return { resolvedModule, failedLookupLocations: addRange(primaryResult.failedLookupLocations as string[], failedLookupLocations) };
                }
            }

            // Default return the result from the first pass
            return primaryResult;
        }

        function resolveNamesWithLocalCache<T extends ResolutionWithFailedLookupLocations, R extends ResolutionWithResolvedFileName>(
            names: string[],
            containingFile: string,
            cache: Map<Map<T>>,
            perDirectoryCache: Map<Map<T>>,
            loader: (name: string, containingFile: string, options: CompilerOptions, host: ModuleResolutionHost) => T,
            getResolutionWithResolvedFileName: GetResolutionWithResolvedFileName<T, R>,
            reusedNames: string[] | undefined,
            logChanges: boolean): R[] {

            const path = resolutionHost.toPath(containingFile);
            const resolutionsInFile = cache.get(path) || cache.set(path, createMap()).get(path);
            const dirPath = getDirectoryPath(path);
            let perDirectoryResolution = perDirectoryCache.get(dirPath);
            if (!perDirectoryResolution) {
                perDirectoryResolution = createMap();
                perDirectoryCache.set(dirPath, perDirectoryResolution);
            }

            const resolvedModules: R[] = [];
            const compilerOptions = resolutionHost.getCompilationSettings();

            const seenNamesInFile = createMap<true>();
            for (const name of names) {
                let resolution = resolutionsInFile.get(name);
                // Resolution is valid if it is present and not invalidated
                if (!seenNamesInFile.has(name) &&
                    allFilesHaveInvalidatedResolution || !resolution || resolution.isInvalidated) {
                    const existingResolution = resolution;
                    const resolutionInDirectory = perDirectoryResolution.get(name);
                    if (resolutionInDirectory) {
                        resolution = resolutionInDirectory;
                    }
                    else {
                        resolution = loader(name, containingFile, compilerOptions, resolutionHost);
                        perDirectoryResolution.set(name, resolution);
                    }
                    resolutionsInFile.set(name, resolution);
                    if (resolution.failedLookupLocations) {
                        if (existingResolution && existingResolution.failedLookupLocations) {
                            watchAndStopWatchDiffFailedLookupLocations(resolution, existingResolution);
                        }
                        else {
                            watchFailedLookupLocationOfResolution(resolution, 0);
                        }
                    }
                    else if (existingResolution) {
                        stopWatchFailedLookupLocationOfResolution(existingResolution);
                    }
                    if (logChanges && filesWithChangedSetOfUnresolvedImports && !resolutionIsEqualTo(existingResolution, resolution)) {
                        filesWithChangedSetOfUnresolvedImports.push(path);
                        // reset log changes to avoid recording the same file multiple times
                        logChanges = false;
                    }
                }
                Debug.assert(resolution !== undefined && !resolution.isInvalidated);
                seenNamesInFile.set(name, true);
                resolvedModules.push(getResolutionWithResolvedFileName(resolution));
            }

            // Stop watching and remove the unused name
            resolutionsInFile.forEach((resolution, name) => {
                if (!seenNamesInFile.has(name) && !contains(reusedNames, name)) {
                    stopWatchFailedLookupLocationOfResolution(resolution);
                    resolutionsInFile.delete(name);
                }
            });

            return resolvedModules;

            function resolutionIsEqualTo(oldResolution: T, newResolution: T): boolean {
                if (oldResolution === newResolution) {
                    return true;
                }
                if (!oldResolution || !newResolution || oldResolution.isInvalidated) {
                    return false;
                }
                const oldResult = getResolutionWithResolvedFileName(oldResolution);
                const newResult = getResolutionWithResolvedFileName(newResolution);
                if (oldResult === newResult) {
                    return true;
                }
                if (!oldResult || !newResult) {
                    return false;
                }
                return oldResult.resolvedFileName === newResult.resolvedFileName;
            }
        }

        function resolveTypeReferenceDirectives(typeDirectiveNames: string[], containingFile: string): ResolvedTypeReferenceDirective[] {
            return resolveNamesWithLocalCache(
                typeDirectiveNames, containingFile,
                resolvedTypeReferenceDirectives, perDirectoryResolvedTypeReferenceDirectives,
                resolveTypeReferenceDirective, getResolvedTypeReferenceDirective,
                /*reusedNames*/ undefined, /*logChanges*/ false
            );
        }

        function resolveModuleNames(moduleNames: string[], containingFile: string, reusedNames: string[] | undefined): ResolvedModuleFull[] {
            return resolveNamesWithLocalCache(
                moduleNames, containingFile,
                resolvedModuleNames, perDirectoryResolvedModuleNames,
                resolveModuleName, getResolvedModule,
                reusedNames, logChangesWhenResolvingModule
            );
        }

        function isNodeModulesDirectory(dirPath: Path) {
            return endsWith(dirPath, "/node_modules");
        }

        function isNodeModulesAtTypesDirectory(dirPath: Path) {
            return endsWith(dirPath, "/node_modules/@types");
        }

        function isDirectoryAtleastAtLevelFromFSRoot(dirPath: Path, minLevels: number) {
            for (let searchIndex = getRootLength(dirPath); minLevels > 0; minLevels--) {
                searchIndex = dirPath.indexOf(directorySeparator, searchIndex) + 1;
                if (searchIndex === 0) {
                    // Folder isnt at expected minimun levels
                    return false;
                }
            }
            return true;
        }

        function canWatchDirectory(dirPath: Path) {
            return isDirectoryAtleastAtLevelFromFSRoot(dirPath,
                // When root is "/" do not watch directories like:
                // "/", "/user", "/user/username", "/user/username/folderAtRoot"
                // When root is "c:/" do not watch directories like:
                // "c:/", "c:/folderAtRoot"
                dirPath.charCodeAt(0) === CharacterCodes.slash ? 3 : 1);
        }

        function filterFSRootDirectoriesToWatch(watchPath: DirectoryOfFailedLookupWatch, dirPath: Path): DirectoryOfFailedLookupWatch {
            if (!canWatchDirectory(dirPath)) {
                watchPath.ignore = true;
            }
            return watchPath;
        }

        function getDirectoryToWatchFailedLookupLocation(failedLookupLocation: string, failedLookupLocationPath: Path): DirectoryOfFailedLookupWatch {
            if (isInDirectoryPath(rootPath, failedLookupLocationPath)) {
                return { dir: rootDir, dirPath: rootPath };
            }

            let dir = getDirectoryPath(getNormalizedAbsolutePath(failedLookupLocation, getCurrentDirectory()));
            let dirPath = getDirectoryPath(failedLookupLocationPath);

            // If directory path contains node module, get the most parent node_modules directory for watching
            while (stringContains(dirPath, "/node_modules/")) {
                dir = getDirectoryPath(dir);
                dirPath = getDirectoryPath(dirPath);
            }

            // If the directory is node_modules use it to watch
            if (isNodeModulesDirectory(dirPath)) {
                return filterFSRootDirectoriesToWatch({ dir, dirPath }, getDirectoryPath(dirPath));
            }

            // Use some ancestor of the root directory
            if (rootPath !== undefined) {
                while (!isInDirectoryPath(dirPath, rootPath)) {
                    const parentPath = getDirectoryPath(dirPath);
                    if (parentPath === dirPath) {
                        break;
                    }
                    dirPath = parentPath;
                    dir = getDirectoryPath(dir);
                }
            }

            return filterFSRootDirectoriesToWatch({ dir, dirPath }, dirPath);
        }

        function isPathWithDefaultFailedLookupExtension(path: Path) {
            return fileExtensionIsOneOf(path, failedLookupDefaultExtensions);
        }

        function watchAndStopWatchDiffFailedLookupLocations(resolution: ResolutionWithFailedLookupLocations, existingResolution: ResolutionWithFailedLookupLocations) {
            const failedLookupLocations = resolution.failedLookupLocations;
            const existingFailedLookupLocations = existingResolution.failedLookupLocations;
            for (let index = 0; index < failedLookupLocations.length; index++) {
                if (index === existingFailedLookupLocations.length) {
                    // Additional failed lookup locations, watch from this index
                    watchFailedLookupLocationOfResolution(resolution, index);
                    return;
                }
                else if (failedLookupLocations[index] !== existingFailedLookupLocations[index]) {
                    // Different failed lookup locations,
                    // Watch new resolution failed lookup locations from this index and
                    // stop watching existing resolutions from this index
                    watchFailedLookupLocationOfResolution(resolution, index);
                    stopWatchFailedLookupLocationOfResolutionFrom(existingResolution, index);
                    return;
                }
            }

            // All new failed lookup locations are already watched (and are same),
            // Stop watching failed lookup locations of existing resolution after failed lookup locations length
            stopWatchFailedLookupLocationOfResolutionFrom(existingResolution, failedLookupLocations.length);
        }

        function watchFailedLookupLocationOfResolution({ failedLookupLocations }: ResolutionWithFailedLookupLocations, startIndex: number) {
            for (let i = startIndex; i < failedLookupLocations.length; i++) {
                const failedLookupLocation = failedLookupLocations[i];
                const failedLookupLocationPath = resolutionHost.toPath(failedLookupLocation);
                // If the failed lookup location path is not one of the supported extensions,
                // store it in the custom path
                if (!isPathWithDefaultFailedLookupExtension(failedLookupLocationPath)) {
                    const refCount = customFailedLookupPaths.get(failedLookupLocationPath) || 0;
                    customFailedLookupPaths.set(failedLookupLocationPath, refCount + 1);
                }
                const { dir, dirPath, ignore } = getDirectoryToWatchFailedLookupLocation(failedLookupLocation, failedLookupLocationPath);
                if (!ignore) {
                    const dirWatcher = directoryWatchesOfFailedLookups.get(dirPath);
                    if (dirWatcher) {
                        dirWatcher.refCount++;
                    }
                    else {
                        directoryWatchesOfFailedLookups.set(dirPath, { watcher: createDirectoryWatcher(dir, dirPath), refCount: 1 });
                    }
                }
            }
        }

        function stopWatchFailedLookupLocationOfResolution(resolution: ResolutionWithFailedLookupLocations) {
            if (resolution.failedLookupLocations) {
                stopWatchFailedLookupLocationOfResolutionFrom(resolution, 0);
            }
        }

        function stopWatchFailedLookupLocationOfResolutionFrom({ failedLookupLocations }: ResolutionWithFailedLookupLocations, startIndex: number) {
            for (let i = startIndex; i < failedLookupLocations.length; i++) {
                const failedLookupLocation = failedLookupLocations[i];
                const failedLookupLocationPath = resolutionHost.toPath(failedLookupLocation);
                const refCount = customFailedLookupPaths.get(failedLookupLocationPath);
                if (refCount) {
                    if (refCount === 1) {
                        customFailedLookupPaths.delete(failedLookupLocationPath);
                    }
                    else {
                        Debug.assert(refCount > 1);
                        customFailedLookupPaths.set(failedLookupLocationPath, refCount - 1);
                    }
                }
                const { dirPath, ignore } = getDirectoryToWatchFailedLookupLocation(failedLookupLocation, failedLookupLocationPath);
                if (!ignore) {
                    const dirWatcher = directoryWatchesOfFailedLookups.get(dirPath);
                    // Do not close the watcher yet since it might be needed by other failed lookup locations.
                    dirWatcher.refCount--;
                }
            }
        }

        function createDirectoryWatcher(directory: string, dirPath: Path) {
            return resolutionHost.watchDirectoryOfFailedLookupLocation(directory, fileOrDirectory => {
                const fileOrDirectoryPath = resolutionHost.toPath(fileOrDirectory);
                if (cachedDirectoryStructureHost) {
                    // Since the file existance changed, update the sourceFiles cache
                    cachedDirectoryStructureHost.addOrDeleteFileOrDirectory(fileOrDirectory, fileOrDirectoryPath);
                }

                // If the files are added to project root or node_modules directory, always run through the invalidation process
                // Otherwise run through invalidation only if adding to the immediate directory
                if (!allFilesHaveInvalidatedResolution &&
                    dirPath === rootPath || isNodeModulesDirectory(dirPath) || getDirectoryPath(fileOrDirectoryPath) === dirPath) {
                    if (invalidateResolutionOfFailedLookupLocation(fileOrDirectoryPath, dirPath === fileOrDirectoryPath)) {
                        resolutionHost.onInvalidatedResolution();
                    }
                }
            }, WatchDirectoryFlags.Recursive);
        }

        function removeResolutionsOfFileFromCache(cache: Map<Map<ResolutionWithFailedLookupLocations>>, filePath: Path) {
            // Deleted file, stop watching failed lookups for all the resolutions in the file
            const resolutions = cache.get(filePath);
            if (resolutions) {
                resolutions.forEach(stopWatchFailedLookupLocationOfResolution);
                cache.delete(filePath);
            }
        }

        function removeResolutionsOfFile(filePath: Path) {
            removeResolutionsOfFileFromCache(resolvedModuleNames, filePath);
            removeResolutionsOfFileFromCache(resolvedTypeReferenceDirectives, filePath);
        }

        function invalidateResolutionCache<T extends ResolutionWithFailedLookupLocations, R extends ResolutionWithResolvedFileName>(
            cache: Map<Map<T>>,
            isInvalidatedResolution: (resolution: T, getResolutionWithResolvedFileName: GetResolutionWithResolvedFileName<T, R>) => boolean,
            getResolutionWithResolvedFileName: GetResolutionWithResolvedFileName<T, R>
        ) {
            const seen = createMap<Map<true>>();
            cache.forEach((resolutions, containingFilePath) => {
                const dirPath = getDirectoryPath(containingFilePath);
                let seenInDir = seen.get(dirPath);
                if (!seenInDir) {
                    seenInDir = createMap<true>();
                    seen.set(dirPath, seenInDir);
                }
                resolutions.forEach((resolution, name) => {
                    if (seenInDir.has(name)) {
                        return;
                    }
                    seenInDir.set(name, true);
                    if (!resolution.isInvalidated && isInvalidatedResolution(resolution, getResolutionWithResolvedFileName)) {
                        // Mark the file as needing re-evaluation of module resolution instead of using it blindly.
                        resolution.isInvalidated = true;
                        (filesWithInvalidatedResolutions || (filesWithInvalidatedResolutions = createMap<true>())).set(containingFilePath, true);
                    }
                });
            });
        }

        function hasReachedResolutionIterationLimit() {
            const maxSize = resolutionHost.maxNumberOfFilesToIterateForInvalidation || maxNumberOfFilesToIterateForInvalidation;
            return resolvedModuleNames.size > maxSize || resolvedTypeReferenceDirectives.size > maxSize;
        }

        function invalidateResolutions(
            isInvalidatedResolution: (resolution: ResolutionWithFailedLookupLocations, getResolutionWithResolvedFileName: GetResolutionWithResolvedFileName) => boolean,
        ) {
            // If more than maxNumberOfFilesToIterateForInvalidation present,
            // just invalidated all files and recalculate the resolutions for files instead
            if (hasReachedResolutionIterationLimit()) {
                allFilesHaveInvalidatedResolution = true;
                return;
            }
            invalidateResolutionCache(resolvedModuleNames, isInvalidatedResolution, getResolvedModule);
            invalidateResolutionCache(resolvedTypeReferenceDirectives, isInvalidatedResolution, getResolvedTypeReferenceDirective);
        }

        function invalidateResolutionOfFile(filePath: Path) {
            removeResolutionsOfFile(filePath);
            invalidateResolutions(
                // Resolution is invalidated if the resulting file name is same as the deleted file path
                (resolution, getResolutionWithResolvedFileName) => {
                    const result = getResolutionWithResolvedFileName(resolution);
                    return result && resolutionHost.toPath(result.resolvedFileName) === filePath;
                }
            );
        }

        function invalidateResolutionOfFailedLookupLocation(fileOrDirectoryPath: Path, isCreatingWatchedDirectory: boolean) {
            let isChangedFailedLookupLocation: (location: string) => boolean;
            if (isCreatingWatchedDirectory) {
                // Watching directory is created
                // Invalidate any resolution has failed lookup in this directory
                isChangedFailedLookupLocation = location => isInDirectoryPath(fileOrDirectoryPath, resolutionHost.toPath(location));
            }
            else {
                // Some file or directory in the watching directory is created
                // Return early if it does not have any of the watching extension or not the custom failed lookup path
                const dirOfFileOrDirectory = getDirectoryPath(fileOrDirectoryPath);
                if (isNodeModulesAtTypesDirectory(dirOfFileOrDirectory) || isNodeModulesDirectory(dirOfFileOrDirectory)) {
                    // Invalidate any resolution from this directory
                    isChangedFailedLookupLocation = location => {
                        const locationPath = resolutionHost.toPath(location);
                        return locationPath === fileOrDirectoryPath || startsWith(resolutionHost.toPath(location), fileOrDirectoryPath);
                    };
                }
                else {
                    if (!isPathWithDefaultFailedLookupExtension(fileOrDirectoryPath) && !customFailedLookupPaths.has(fileOrDirectoryPath)) {
                        return false;
                    }
                    // Ignore emits from the program
                    if (isEmittedFileOfProgram(resolutionHost.getCurrentProgram(), fileOrDirectoryPath)) {
                        return false;
                    }
                    // Resolution need to be invalidated if failed lookup location is same as the file or directory getting created
                    isChangedFailedLookupLocation = location => resolutionHost.toPath(location) === fileOrDirectoryPath;
                }
            }
            const hasChangedFailedLookupLocation = (resolution: ResolutionWithFailedLookupLocations) => some(resolution.failedLookupLocations, isChangedFailedLookupLocation);
            const invalidatedFilesCount = filesWithInvalidatedResolutions && filesWithInvalidatedResolutions.size;
            invalidateResolutions(
                // Resolution is invalidated if the resulting file name is same as the deleted file path
                hasChangedFailedLookupLocation
            );
            return allFilesHaveInvalidatedResolution || filesWithInvalidatedResolutions && filesWithInvalidatedResolutions.size !== invalidatedFilesCount;
        }

        function closeTypeRootsWatch() {
            clearMap(typeRootsWatches, closeFileWatcher);
        }

        function createTypeRootsWatch(_typeRootPath: string, typeRoot: string): FileWatcher {
            // Create new watch and recursive info
            return resolutionHost.watchTypeRootsDirectory(typeRoot, fileOrDirectory => {
                const fileOrDirectoryPath = resolutionHost.toPath(fileOrDirectory);
                if (cachedDirectoryStructureHost) {
                    // Since the file existance changed, update the sourceFiles cache
                    cachedDirectoryStructureHost.addOrDeleteFileOrDirectory(fileOrDirectory, fileOrDirectoryPath);
                }

                // For now just recompile
                // We could potentially store more data here about whether it was/would be really be used or not
                // and with that determine to trigger compilation but for now this is enough
                resolutionHost.onChangedAutomaticTypeDirectiveNames();
            }, WatchDirectoryFlags.Recursive);
        }

        /**
         * Watches the types that would get added as part of getAutomaticTypeDirectiveNames
         * To be called when compiler options change
         */
        function updateTypeRootsWatch() {
            const options = resolutionHost.getCompilationSettings();
            if (options.types) {
                // No need to do any watch since resolution cache is going to handle the failed lookups
                // for the types added by this
                closeTypeRootsWatch();
                return;
            }

            // we need to assume the directories exist to ensure that we can get all the type root directories that get included
            // But filter directories that are at root level to say directory doesnt exist, so that we arent watching them
            const typeRoots = getEffectiveTypeRoots(options, { directoryExists: directoryExistsForTypeRootWatch, getCurrentDirectory });
            if (typeRoots) {
                mutateMap(
                    typeRootsWatches,
                    arrayToMap(typeRoots, tr => resolutionHost.toPath(tr)),
                    {
                        createNewValue: createTypeRootsWatch,
                        onDeleteValue: closeFileWatcher
                    }
                );
            }
            else {
                closeTypeRootsWatch();
            }
        }

        /**
         * Use this function to return if directory exists to get type roots to watch
         * If we return directory exists then only the paths will be added to type roots
         * Hence return true for all directories except root directories which are filtered from watching
         */
        function directoryExistsForTypeRootWatch(nodeTypesDirectory: string) {
            const dir = getDirectoryPath(getDirectoryPath(nodeTypesDirectory));
            const dirPath = resolutionHost.toPath(dir);
            return dirPath === rootPath || canWatchDirectory(dirPath);
        }
    }
}
