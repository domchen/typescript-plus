declare function all(a?: number, b?: number): void;
declare function weird(a?: number | string, b?: number | string): void;
declare function prefix(s: string, a?: number, b?: number): void;
declare function rest(s: string, a?: number, b?: number,  ...rest: number[]): void;
declare function normal(s: string): void;
declare function thunk(): string;

declare var ns: number[];
declare var mixed: (number | string)[];
declare var tuple: [number, string];

// good
all(...ns)
weird(...ns)
weird(...mixed)
weird(...tuple)
prefix("a", ...ns)
rest("d", ...ns)


// this covers the arguments case
normal("g", ...ns)
normal("h", ...mixed)
normal("i", ...tuple)
thunk(...ns)
thunk(...mixed)
thunk(...tuple)

// bad
all(...mixed)
all(...tuple)
prefix("b", ...mixed)
prefix("c", ...tuple)
rest("e", ...mixed)
rest("f", ...tuple)
prefix(...ns) // required parameters are required
prefix(...mixed)
prefix(...tuple)
