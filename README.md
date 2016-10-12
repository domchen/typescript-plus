[![npm version](https://badge.fury.io/js/typescript.svg)](https://www.npmjs.com/package/typescript-plus)
[![Downloads](https://img.shields.io/npm/dm/TypeScript.svg)](https://www.npmjs.com/package/typescript-plus)

# typescript-plus



TypeScript is a language for application-scale JavaScript (For more information, please visit : [typescriptlang.org](http://www.typescriptlang.org/)). The typescript-plus project provides extra features to the original typescript compiler, such as emitting reflection data of class, get/set accessor optimization and conditional compilation.

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


## Documentation

To learn how to use the original compiler, please visit the following links:

*  [Quick tutorial](http://www.typescriptlang.org/Tutorial)
*  [Programming handbook](http://www.typescriptlang.org/Handbook)
*  [Language specification](https://github.com/Microsoft/TypeScript/blob/master/doc/spec.md)
*  [Homepage](http://www.typescriptlang.org/)

##Extra Options

| Option                 | Type    | Default | Description                                        |
| ---------------------- |:-------:| -------:| --------------------------------------------------:|
| --emitReflection       | boolean | false   | Emit the reflection data of class .                |
| --accessorOptimization | boolean | false   | If an accessor contains only one call to another method, use that method as the accessor method directly.|
| defines                | Object  |         | Replace the global variables with the constants defined in the "defines"" object. |

Note: The "defines" option is only allowed in tsconfig.json, and not through command-line switches.

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
            "DEBUG": false,  // the value can be boolean, number or string.
            "RELEASE": true
        }

    },  
    "files": [
        "core.ts",
        "sys.ts"
    ]  
}

```