//// [shouldNotPrintNullEscapesIntoOctalLiterals.ts]
"use strict";
`\x001`;
`\u00001`;
`\u{00000000}1`;
`\u{000000}1`;
`\u{0}1`;

//// [shouldNotPrintNullEscapesIntoOctalLiterals.js]
"use strict";
"\x001";
"\x001";
"\x001";
"\x001";
"\x001";
