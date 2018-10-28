//// [intersectionsOfLargeUnions.ts]
// Repro from #23977

export function assertIsElement(node: Node | null): node is Element {
    let nodeType = node === null ? null : node.nodeType;
    return nodeType === 1;
}
  
export function assertNodeTagName<
    T extends keyof ElementTagNameMap,
    U extends ElementTagNameMap[T]>(node: Node | null, tagName: T): node is U {
    if (assertIsElement(node)) {
        const nodeTagName = node.tagName.toLowerCase();
         return nodeTagName === tagName;
    }
    return false;
}
  
export function assertNodeProperty<
    T extends keyof ElementTagNameMap,
    P extends keyof ElementTagNameMap[T],
    V extends HTMLElementTagNameMap[T][P]>(node: Node | null, tagName: T, prop: P, value: V) {
    if (assertNodeTagName(node, tagName)) {
        node[prop];
    }
}


//// [intersectionsOfLargeUnions.js]
"use strict";
// Repro from #23977
exports.__esModule = true;
function assertIsElement(node) {
    var nodeType = node === null ? null : node.nodeType;
    return nodeType === 1;
}
exports.assertIsElement = assertIsElement;
function assertNodeTagName(node, tagName) {
    if (assertIsElement(node)) {
        var nodeTagName = node.tagName.toLowerCase();
        return nodeTagName === tagName;
    }
    return false;
}
exports.assertNodeTagName = assertNodeTagName;
function assertNodeProperty(node, tagName, prop, value) {
    if (assertNodeTagName(node, tagName)) {
        node[prop];
    }
}
exports.assertNodeProperty = assertNodeProperty;
