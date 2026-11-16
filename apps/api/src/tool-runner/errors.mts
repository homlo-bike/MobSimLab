/**
 * An error a tool throws on purpose because the input is not acceptable. Its message is shown to the person
 * who uploaded the file, so it names what is wrong with the file, never internals. Any other error is a crash
 * of the tool and is only logged.
 */
export class ToolError extends Error {}
