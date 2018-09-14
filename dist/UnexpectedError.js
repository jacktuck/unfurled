"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class UnexpectedError extends Error {
    // static EXPECTED_JSON = {
    //   message: 'Wrong content type header - "application/json" was expected',
    //   name: 'WRONG_CONTENT_TYPE'
    // }
    constructor(errorType) {
        super(errorType.message);
        this.name = errorType.name;
        this.stack = new Error().stack;
    }
}
UnexpectedError.EXPECTED_HTML = {
    message: 'Wrong content type header - "text/html" or "application/xhtml+xml" was expected',
    name: 'WRONG_CONTENT_TYPE'
};
exports.default = UnexpectedError;
//# sourceMappingURL=UnexpectedError.js.map