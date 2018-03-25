/// <reference path='fourslash.ts' />

////const f = (): number[] => {
////    await Promise.resolve([1]);
////}

verify.codeFix({
    description: "Add async modifier to containing function",
    newFileContent:
`const f = async (): Promise<number[]> => {
    await Promise.resolve([1]);
}`,
});
