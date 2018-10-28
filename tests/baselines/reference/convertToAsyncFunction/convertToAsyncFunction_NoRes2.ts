// ==ORIGINAL==

function /*[#|*/f/*|]*/():Promise<void | Response> {
    return fetch('https://typescriptlang.org').then(undefined).catch(rej => console.log(rej));
}

// ==ASYNC FUNCTION::Convert to async function==

async function f():Promise<void | Response> {
    try {
        await fetch('https://typescriptlang.org');
    }
    catch (rej) {
        return console.log(rej);
    }
}
