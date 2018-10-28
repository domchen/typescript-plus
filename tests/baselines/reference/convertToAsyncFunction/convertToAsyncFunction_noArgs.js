// ==ORIGINAL==

function delay(millis) {
    throw "no"
}

function /*[#|*/main2/*|]*/() {
    console.log("Please wait. Loading.");
    return delay(500)
        .then(() => { console.log("."); return delay(500); })
        .then(() => { console.log("."); return delay(500); })
        .then(() => { console.log("."); return delay(500); })
}

// ==ASYNC FUNCTION::Convert to async function==

function delay(millis) {
    throw "no"
}

async function main2() {
    console.log("Please wait. Loading.");
    await delay(500);
    console.log(".");
    await delay(500);
    console.log(".");
    await delay(500);
    console.log(".");
    return delay(500);
}
