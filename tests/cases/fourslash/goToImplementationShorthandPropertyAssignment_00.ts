/// <reference path='fourslash.ts'/>

// Should handle shorthand property assignments of class constructors

//// interface Foo {
////     someFunction(): void;
//// }
////
//// interface FooConstructor {
////     new (): Foo
//// }
////
//// interface Bar {
////     Foo: FooConstructor;
//// }
////
//// var x = class /*classExpression*/Foo {
////     createBarInClassExpression(): Bar {
////         return {
////             Fo/*classExpressionRef*/o
////         };
////     }
////
////     someFunction() {}
//// }
////
//// class /*declaredClass*/Foo {
////
//// }
////
//// function createBarUsingClassDeclaration(): Bar {
////     return {
////         Fo/*declaredClassRef*/o
////     };
//// }

goTo.marker("classExpressionRef");
goTo.implementation();
verify.caretAtMarker("classExpression");

goTo.marker("declaredClassRef");
goTo.implementation();
verify.caretAtMarker("declaredClass");
