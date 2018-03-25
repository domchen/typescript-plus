/// <reference path="fourslash.ts" />

// @Filename: /a.ts
////export function foo() {}

// @Filename: /b.ts
////import * as a from "./a";
////f/**/;

goTo.marker("");
verify.completionListContains({ name: "foo", source: "/a" }, "function foo(): void", "", "function", /*spanIndex*/ undefined, /*hasAction*/ true, {
    includeExternalModuleExports: true,
    sourceDisplay: "./a",
});

verify.applyCodeActionFromCompletion("", {
    name: "foo",
    source: "/a",
    description: `Change 'foo' to 'a.foo'`,
    newFileContent: `import * as a from "./a";
a.f;`,
});
