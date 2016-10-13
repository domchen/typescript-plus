[![npm version](https://badge.fury.io/js/typescript-plus.svg)](https://www.npmjs.com/package/typescript-plus)

# typescript-plus



TypeScript is a language for application-scale JavaScript, For more information, please visit : [TypeScript](https://github.com/Microsoft/TypeScript).

The typescript-plus provides extra features to the original typescript compiler, such as emitting reflection data of class, get / set accessors optimization and conditional compilation. This project will be updated after the original TypeScript project publishing a new release.

## Installing

First make sure you have installed the latest version of [node.js](http://nodejs.org/)
(You may need to restart your computer after this step).

For use as a command line app:

```
npm install -g typescript-plus
```

For programmatic use:

```
npm install typescript-plus
```

## Usage

```
tsc-plus [input files] [options]
```

To learn how to use the original typescript compiler, please visit the following links:

*  [Quick tutorial](http://www.typescriptlang.org/Tutorial)
*  [Programming handbook](http://www.typescriptlang.org/Handbook)
*  [Language specification](https://github.com/Microsoft/TypeScript/blob/master/doc/spec.md)
*  [Homepage](http://www.typescriptlang.org/)

## Extra Options

| Option                  | Type    | Default| Description                                        |
|:----------------------- |:-------:|:------:| :------------------------------------------------- |
| emitReflection        | boolean | false  | Emit the reflection data of class .                |
| accessorOptimization  | boolean | false  | If an accessor contains only one call to another method, use that method as the accessor method directly.|
| defines                 | Object  |        | Replace the global variables with the constants defined in the "defines"" object. |


Example tsconfig.json file:

```
{
    "compilerOptions": {
        "module": "commonjs",
        "noImplicitAny": true,
        "removeComments": true,
        "preserveConstEnums": true,
        "sourceMap": true,
        "emitReflection": true,
        "accessorOptimization": true,
        "defines": {
            "DEBUG": false,
            "RELEASE": true
        }

    },  
    "files": [
        "core.ts",
        "sys.ts"
    ]  
}

```

## Reflection

Pass `--emitReflection` to the command-line tool or add `"emitReflection": true` to the `compilerOptions` in tsconfig.json file to enable this feature.

TypeScript:

```
namespace ts {
    export interface IPerson {
        name:string;
    }
    
    export class Student implements IPerson {
        public name:string = "";
    }
}
```
JavaScript:

```
var ts;
(function (ts) {
    var Student = (function () {
        function Student() {
            this.name = "";
        }
        return Student;
    }());
    ts.Student = Student;
    __reflect(Student.prototype, "ts.Student", ["ts.IPerson"]);
})(ts || (ts = {}));

```
The `__reflect` helper function is just like the `__extends` function, it is emitted only once in one file.

Then you can use the helper funtions in [reflection.ts](tools/reflection.ts) to get the qualified class name of an instance:

```
let student = new ts.Student();
ts.getQualifiedClassName(student);  // "ts.Student"
```
or do some type checking:

```
ts.is(student, "ts.Student"); // true
ts.is(student, "ts.IPersion"); // true
```

## Accessor Optimization

Pass `--accessorOptimization` to the command-line tool or add `"accessorOptimization": true` to the `compilerOptions` in tsconfig.json file to enable this feature.

As we know, we can't override the get / set accessors of super class in TypeScript. To solve the problem, we usually forward the call to the set accessor to another method:

TypeScript:

```
class Student {

    public _name:string;

    protected setName(value:string):void {
        this._name = value;
    }

    public get name():string {
        return this._name;
    }

    public set name(value:string) {
        this.setName(value);
    }
}
```
It does solve the problem, but also brings a performance issue, that two functions have to be called each time we call a set accessor. With the `--accessorOptimization` switch on, if the accessor contains only one call to another method, the compiler use that method to define accessor directly.

Javascript:

```
var Student = (function () {
    function Student() {
    }
    Student.prototype.setName = function (value) {
        this._name = value;
    };
    Object.defineProperty(Student.prototype, "name", {
        get: function () {
            return this._name;
        },
        set: Student.prototype.setName,
        enumerable: true,
        configurable: true
    });
    return Student;
}());
```

If you define the `setName()` method after the set accessor, the final result looks like this:

```
var Student = (function () {
    function Student() {
    }
    Object.defineProperty(Student.prototype, "name", {
        get: function () {
            return this._name;
        },
        set: setName,
        enumerable: true,
        configurable: true
    });
    Student.prototype.setName = setName;
    function setName(value) {
        this._name = value;
    };
    return Student;
}());
```
Either way, it works.

## Conditional Compilation

The `defines` option is only allowed in tsconfig.json, and not through command-line switches.

You can use the `defines` option to declare global variables that the compiler will assume to be constants (unless defined in scope). Then all the defined global variables will be replaced with the corresponding constants. For example:

tsconfig.json:

```
{
    "compilerOptions": {
        "defines": {
            "DEBUG": false,
            "LANGUAGE": "en_US"
        }
    }
}

```
TypeScript:

```
declare var DEBUG:boolean;
declare var LANGUAGE:string;

if (DEBUG) {
    console.log("DEBUG is true");
}

console.log("The language is : " + LANGUAGE);

function someFunction():void {
    let DEBUG = true;
    if (DEBUG) {
        console.log("DEBUG is true");
    }
}

```
JavaScript:

```
if (false) {
    console.log("DEBUG is true");
}

console.log("The language is : " + "en_US");

function someFunction() {
    var DEBUG = true;
    if (DEBUG) {
        console.log("DEBUG is true");
    }
}
```
As you can see, the second `if(DEBUG)` in `someFunction` is not replaced because it is defined in scope.

Note that the compiler does not dropping the unreachable code, because it is can be easily done by other tools like [UglifyJS](http://lisperator.net/uglifyjs/) or [Google Closure Compiler](https://developers.google.com/closure/compiler/).

