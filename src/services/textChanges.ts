/* @internal */
namespace ts.textChanges {

    /**
     * Currently for simplicity we store recovered positions on the node itself.
     * It can be changed to side-table later if we decide that current design is too invasive.
     */
    function getPos(n: TextRange): number {
        const result = (<any>n).__pos;
        Debug.assert(typeof result === "number");
        return result;
    }

    function setPos(n: TextRange, pos: number): void {
        Debug.assert(typeof pos === "number");
        (<any>n).__pos = pos;
    }

    function getEnd(n: TextRange): number {
        const result = (<any>n).__end;
        Debug.assert(typeof result === "number");
        return result;
    }

    function setEnd(n: TextRange, end: number): void {
        Debug.assert(typeof end === "number");
        (<any>n).__end = end;
    }

    export interface ConfigurableStart {
        /** True to use getStart() (NB, not getFullStart()) without adjustment. */
        useNonAdjustedStartPosition?: boolean;
    }
    export interface ConfigurableEnd {
        /** True to use getEnd() without adjustment. */
        useNonAdjustedEndPosition?: boolean;
    }

    export enum Position {
        FullStart,
        Start
    }

    function skipWhitespacesAndLineBreaks(text: string, start: number) {
        return skipTrivia(text, start, /*stopAfterLineBreak*/ false, /*stopAtComments*/ true);
    }

    function hasCommentsBeforeLineBreak(text: string, start: number) {
        let i = start;
        while (i < text.length) {
            const ch = text.charCodeAt(i);
            if (isWhiteSpaceSingleLine(ch)) {
                i++;
                continue;
            }
            return ch === CharacterCodes.slash;
        }
        return false;
    }

    /**
     * Usually node.pos points to a position immediately after the previous token.
     * If this position is used as a beginning of the span to remove - it might lead to removing the trailing trivia of the previous node, i.e:
     * const x; // this is x
     *        ^ - pos for the next variable declaration will point here
     * const y; // this is y
     *        ^ - end for previous variable declaration
     * Usually leading trivia of the variable declaration 'y' should not include trailing trivia (whitespace, comment 'this is x' and newline) from the preceding
     * variable declaration and trailing trivia for 'y' should include (whitespace, comment 'this is y', newline).
     * By default when removing nodes we adjust start and end positions to respect specification of the trivia above.
     * If pos\end should be interpreted literally 'useNonAdjustedStartPosition' or 'useNonAdjustedEndPosition' should be set to true
     */
    export interface ConfigurableStartEnd extends ConfigurableStart, ConfigurableEnd {}

    export const useNonAdjustedPositions: ConfigurableStartEnd = {
        useNonAdjustedStartPosition: true,
        useNonAdjustedEndPosition: true,
    };

    export interface InsertNodeOptions {
        /**
         * Text to be inserted before the new node
         */
        prefix?: string;
        /**
         * Text to be inserted after the new node
         */
        suffix?: string;
        /**
         * Text of inserted node will be formatted with this indentation, otherwise indentation will be inferred from the old node
         */
        indentation?: number;
        /**
         * Text of inserted node will be formatted with this delta, otherwise delta will be inferred from the new node kind
         */
        delta?: number;
        /**
         * Do not trim leading white spaces in the edit range
         */
        preserveLeadingWhitespace?: boolean;
    }

    export interface ReplaceWithMultipleNodesOptions extends InsertNodeOptions {
        readonly joiner?: string;
    }

    enum ChangeKind {
        Remove,
        ReplaceWithSingleNode,
        ReplaceWithMultipleNodes,
        Text,
    }

    type Change = ReplaceWithSingleNode | ReplaceWithMultipleNodes | RemoveNode | ChangeText;

    interface BaseChange {
        readonly sourceFile: SourceFile;
        readonly range: TextRange;
    }

    export interface ChangeNodeOptions extends ConfigurableStartEnd, InsertNodeOptions {}
    interface ReplaceWithSingleNode extends BaseChange {
        readonly kind: ChangeKind.ReplaceWithSingleNode;
        readonly node: Node;
        readonly options?: InsertNodeOptions;
    }

    interface RemoveNode extends BaseChange {
        readonly kind: ChangeKind.Remove;
        readonly node?: never;
        readonly options?: never;
    }

    interface ReplaceWithMultipleNodes extends BaseChange {
        readonly kind: ChangeKind.ReplaceWithMultipleNodes;
        readonly nodes: ReadonlyArray<Node>;
        readonly options?: ReplaceWithMultipleNodesOptions;
    }

    interface ChangeText extends BaseChange {
        readonly kind: ChangeKind.Text;
        readonly text: string;
    }

    function getAdjustedRange(sourceFile: SourceFile, startNode: Node, endNode: Node, options: ConfigurableStartEnd): TextRange {
        return { pos: getAdjustedStartPosition(sourceFile, startNode, options, Position.Start), end: getAdjustedEndPosition(sourceFile, endNode, options) };
    }

    function getAdjustedStartPosition(sourceFile: SourceFile, node: Node, options: ConfigurableStart, position: Position) {
        if (options.useNonAdjustedStartPosition) {
            return node.getStart(sourceFile);
        }
        const fullStart = node.getFullStart();
        const start = node.getStart(sourceFile);
        if (fullStart === start) {
            return start;
        }
        const fullStartLine = getLineStartPositionForPosition(fullStart, sourceFile);
        const startLine = getLineStartPositionForPosition(start, sourceFile);
        if (startLine === fullStartLine) {
            // full start and start of the node are on the same line
            //   a,     b;
            //    ^     ^
            //    |   start
            // fullstart
            // when b is replaced - we usually want to keep the leading trvia
            // when b is deleted - we delete it
            return position === Position.Start ? start : fullStart;
        }
        // get start position of the line following the line that contains fullstart position
        // (but only if the fullstart isn't the very beginning of the file)
        const nextLineStart = fullStart > 0 ? 1 : 0;
        let adjustedStartPosition = getStartPositionOfLine(getLineOfLocalPosition(sourceFile, fullStartLine) + nextLineStart, sourceFile);
        // skip whitespaces/newlines
        adjustedStartPosition = skipWhitespacesAndLineBreaks(sourceFile.text, adjustedStartPosition);
        return getStartPositionOfLine(getLineOfLocalPosition(sourceFile, adjustedStartPosition), sourceFile);
    }

    function getAdjustedEndPosition(sourceFile: SourceFile, node: Node, options: ConfigurableEnd) {
        const { end } = node;
        if (options.useNonAdjustedEndPosition || isExpression(node)) {
            return end;
        }
        const newEnd = skipTrivia(sourceFile.text, end, /*stopAfterLineBreak*/ true);
        return newEnd !== end && isLineBreak(sourceFile.text.charCodeAt(newEnd - 1))
            ? newEnd
            : end;
    }

    /**
     * Checks if 'candidate' argument is a legal separator in the list that contains 'node' as an element
     */
    function isSeparator(node: Node, candidate: Node | undefined): candidate is Token<SyntaxKind.CommaToken | SyntaxKind.SemicolonToken> {
        return !!candidate && !!node.parent && (candidate.kind === SyntaxKind.CommaToken || (candidate.kind === SyntaxKind.SemicolonToken && node.parent.kind === SyntaxKind.ObjectLiteralExpression));
    }

    function spaces(count: number) {
        let s = "";
        for (let i = 0; i < count; i++) {
            s += " ";
        }
        return s;
    }

    export interface TextChangesContext {
        host: LanguageServiceHost;
        formatContext: formatting.FormatContext;
    }

    export type TypeAnnotatable = SignatureDeclaration | VariableDeclaration | ParameterDeclaration | PropertyDeclaration | PropertySignature;

    export class ChangeTracker {
        private readonly changes: Change[] = [];
        private readonly newFiles: { readonly oldFile: SourceFile | undefined, readonly fileName: string, readonly statements: ReadonlyArray<Statement> }[] = [];
        private readonly classesWithNodesInsertedAtStart = createMap<{ readonly node: ClassDeclaration | InterfaceDeclaration | ObjectLiteralExpression, readonly sourceFile: SourceFile }>(); // Set<ClassDeclaration> implemented as Map<node id, ClassDeclaration>
        private readonly deletedNodes: { readonly sourceFile: SourceFile, readonly node: Node | NodeArray<TypeParameterDeclaration> }[] = [];

        public static fromContext(context: TextChangesContext): ChangeTracker {
            return new ChangeTracker(getNewLineOrDefaultFromHost(context.host, context.formatContext.options), context.formatContext);
        }

        public static with(context: TextChangesContext, cb: (tracker: ChangeTracker) => void): FileTextChanges[] {
            const tracker = ChangeTracker.fromContext(context);
            cb(tracker);
            return tracker.getChanges();
        }

        /** Public for tests only. Other callers should use `ChangeTracker.with`. */
        constructor(private readonly newLineCharacter: string, private readonly formatContext: formatting.FormatContext) {}

        public deleteRange(sourceFile: SourceFile, range: TextRange) {
            this.changes.push({ kind: ChangeKind.Remove, sourceFile, range });
            return this;
        }

        delete(sourceFile: SourceFile, node: Node | NodeArray<TypeParameterDeclaration>): void {
            this.deletedNodes.push({ sourceFile, node });
        }

        public deleteModifier(sourceFile: SourceFile, modifier: Modifier): void {
            this.deleteRange(sourceFile, { pos: modifier.getStart(sourceFile), end: skipTrivia(sourceFile.text, modifier.end, /*stopAfterLineBreak*/ true) });
        }

        public deleteNodeRange(sourceFile: SourceFile, startNode: Node, endNode: Node, options: ConfigurableStartEnd = {}) {
            const startPosition = getAdjustedStartPosition(sourceFile, startNode, options, Position.FullStart);
            const endPosition = getAdjustedEndPosition(sourceFile, endNode, options);
            this.deleteRange(sourceFile, { pos: startPosition, end: endPosition });
            return this;
        }

        public deleteNodeRangeExcludingEnd(sourceFile: SourceFile, startNode: Node, afterEndNode: Node | undefined, options: ConfigurableStartEnd = {}): void {
            const startPosition = getAdjustedStartPosition(sourceFile, startNode, options, Position.FullStart);
            const endPosition = afterEndNode === undefined ? sourceFile.text.length : getAdjustedStartPosition(sourceFile, afterEndNode, options, Position.FullStart);
            this.deleteRange(sourceFile, { pos: startPosition, end: endPosition });
        }

        public replaceRange(sourceFile: SourceFile, range: TextRange, newNode: Node, options: InsertNodeOptions = {}) {
            this.changes.push({ kind: ChangeKind.ReplaceWithSingleNode, sourceFile, range, options, node: newNode });
            return this;
        }

        public replaceNode(sourceFile: SourceFile, oldNode: Node, newNode: Node, options: ChangeNodeOptions = useNonAdjustedPositions) {
            return this.replaceRange(sourceFile, getAdjustedRange(sourceFile, oldNode, oldNode, options), newNode, options);
        }

        public replaceNodeRange(sourceFile: SourceFile, startNode: Node, endNode: Node, newNode: Node, options: ChangeNodeOptions = useNonAdjustedPositions) {
            this.replaceRange(sourceFile, getAdjustedRange(sourceFile, startNode, endNode, options), newNode, options);
        }

        private replaceRangeWithNodes(sourceFile: SourceFile, range: TextRange, newNodes: ReadonlyArray<Node>, options: ReplaceWithMultipleNodesOptions & ConfigurableStartEnd = {}) {
            this.changes.push({ kind: ChangeKind.ReplaceWithMultipleNodes, sourceFile, range, options, nodes: newNodes });
            return this;
        }

        public replaceNodeWithNodes(sourceFile: SourceFile, oldNode: Node, newNodes: ReadonlyArray<Node>, options: ChangeNodeOptions = useNonAdjustedPositions) {
            return this.replaceRangeWithNodes(sourceFile, getAdjustedRange(sourceFile, oldNode, oldNode, options), newNodes, options);
        }

        public replaceNodeRangeWithNodes(sourceFile: SourceFile, startNode: Node, endNode: Node, newNodes: ReadonlyArray<Node>, options: ReplaceWithMultipleNodesOptions & ConfigurableStartEnd = useNonAdjustedPositions) {
            return this.replaceRangeWithNodes(sourceFile, getAdjustedRange(sourceFile, startNode, endNode, options), newNodes, options);
        }

        private nextCommaToken (sourceFile: SourceFile, node: Node): Node | undefined {
            const next = findNextToken(node, node.parent, sourceFile);
            return next && next.kind === SyntaxKind.CommaToken ? next : undefined;
        }

        public replacePropertyAssignment(sourceFile: SourceFile, oldNode: PropertyAssignment, newNode: PropertyAssignment) {
            const suffix = this.nextCommaToken(sourceFile, oldNode) ? "" : ("," + this.newLineCharacter);
            return this.replaceNode(sourceFile, oldNode, newNode, { suffix });
        }

        public insertNodeAt(sourceFile: SourceFile, pos: number, newNode: Node, options: InsertNodeOptions = {}) {
            this.replaceRange(sourceFile, createRange(pos), newNode, options);
        }

        private insertNodesAt(sourceFile: SourceFile, pos: number, newNodes: ReadonlyArray<Node>, options: ReplaceWithMultipleNodesOptions = {}): void {
            this.changes.push({ kind: ChangeKind.ReplaceWithMultipleNodes, sourceFile, options, nodes: newNodes, range: { pos, end: pos } });
        }

        public insertNodeAtTopOfFile(sourceFile: SourceFile, newNode: Statement, blankLineBetween: boolean): void {
            const pos = getInsertionPositionAtSourceFileTop(sourceFile);
            this.insertNodeAt(sourceFile, pos, newNode, {
                prefix: pos === 0 ? undefined : this.newLineCharacter,
                suffix: (isLineBreak(sourceFile.text.charCodeAt(pos)) ? "" : this.newLineCharacter) + (blankLineBetween ? this.newLineCharacter : ""),
            });
        }

        public insertNodeBefore(sourceFile: SourceFile, before: Node, newNode: Node, blankLineBetween = false) {
            this.insertNodeAt(sourceFile, getAdjustedStartPosition(sourceFile, before, {}, Position.Start), newNode, this.getOptionsForInsertNodeBefore(before, blankLineBetween));
        }

        public insertModifierBefore(sourceFile: SourceFile, modifier: SyntaxKind, before: Node): void {
            const pos = before.getStart(sourceFile);
            this.replaceRange(sourceFile, { pos, end: pos }, createToken(modifier), { suffix: " " });
        }

        public insertLastModifierBefore(sourceFile: SourceFile, modifier: SyntaxKind, before: Node): void {
            if (!before.modifiers) {
                this.insertModifierBefore(sourceFile, modifier, before);
                return;
            }

            const pos = before.modifiers.end;
            this.replaceRange(sourceFile, { pos, end: pos }, createToken(modifier), { prefix: " " });
        }

        public insertCommentBeforeLine(sourceFile: SourceFile, lineNumber: number, position: number, commentText: string): void {
            const lineStartPosition = getStartPositionOfLine(lineNumber, sourceFile);
            const startPosition = getFirstNonSpaceCharacterPosition(sourceFile.text, lineStartPosition);
            // First try to see if we can put the comment on the previous line.
            // We need to make sure that we are not in the middle of a string literal or a comment.
            // If so, we do not want to separate the node from its comment if we can.
            // Otherwise, add an extra new line immediately before the error span.
            const insertAtLineStart = isValidLocationToAddComment(sourceFile, startPosition);
            const token = getTouchingToken(sourceFile, insertAtLineStart ? startPosition : position);
            const indent = sourceFile.text.slice(lineStartPosition, startPosition);
            const text = `${insertAtLineStart ? "" : this.newLineCharacter}//${commentText}${this.newLineCharacter}${indent}`;
            this.insertText(sourceFile, token.getStart(sourceFile), text);
        }

        public replaceRangeWithText(sourceFile: SourceFile, range: TextRange, text: string) {
            this.changes.push({ kind: ChangeKind.Text, sourceFile, range, text });
        }

        public insertText(sourceFile: SourceFile, pos: number, text: string): void {
            this.replaceRangeWithText(sourceFile, createRange(pos), text);
        }

        /** Prefer this over replacing a node with another that has a type annotation, as it avoids reformatting the other parts of the node. */
        public tryInsertTypeAnnotation(sourceFile: SourceFile, node: TypeAnnotatable, type: TypeNode): void {
            let endNode: Node | undefined;
            if (isFunctionLike(node)) {
                endNode = findChildOfKind(node, SyntaxKind.CloseParenToken, sourceFile);
                if (!endNode) {
                    if (!isArrowFunction(node)) return; // Function missing parentheses, give up
                    // If no `)`, is an arrow function `x => x`, so use the end of the first parameter
                    endNode = first(node.parameters);
                }
            }
            else {
                endNode = node.kind !== SyntaxKind.VariableDeclaration && node.questionToken ? node.questionToken : node.name;
            }

            this.insertNodeAt(sourceFile, endNode.end, type, { prefix: ": " });
        }

        public insertTypeParameters(sourceFile: SourceFile, node: SignatureDeclaration, typeParameters: ReadonlyArray<TypeParameterDeclaration>): void {
            // If no `(`, is an arrow function `x => x`, so use the pos of the first parameter
            const start = (findChildOfKind(node, SyntaxKind.OpenParenToken, sourceFile) || first(node.parameters)).getStart(sourceFile);
            this.insertNodesAt(sourceFile, start, typeParameters, { prefix: "<", suffix: ">" });
        }

        private getOptionsForInsertNodeBefore(before: Node, doubleNewlines: boolean): InsertNodeOptions {
            if (isStatement(before) || isClassElement(before)) {
                return { suffix: doubleNewlines ? this.newLineCharacter + this.newLineCharacter : this.newLineCharacter };
            }
            else if (isVariableDeclaration(before)) { // insert `x = 1, ` into `const x = 1, y = 2;
                return { suffix: ", " };
            }
            else if (isParameter(before)) {
                return {};
            }
            else if (isStringLiteral(before) && isImportDeclaration(before.parent) || isNamedImports(before)) {
                return { suffix: ", " };
            }
            return Debug.failBadSyntaxKind(before); // We haven't handled this kind of node yet -- add it
        }

        public insertNodeAtConstructorStart(sourceFile: SourceFile, ctr: ConstructorDeclaration, newStatement: Statement): void {
            const firstStatement = firstOrUndefined(ctr.body!.statements);
            if (!firstStatement || !ctr.body!.multiLine) {
                this.replaceConstructorBody(sourceFile, ctr, [newStatement, ...ctr.body!.statements]);
            }
            else {
                this.insertNodeBefore(sourceFile, firstStatement, newStatement);
            }
        }

        public insertNodeAtConstructorEnd(sourceFile: SourceFile, ctr: ConstructorDeclaration, newStatement: Statement): void {
            const lastStatement = lastOrUndefined(ctr.body!.statements);
            if (!lastStatement || !ctr.body!.multiLine) {
                this.replaceConstructorBody(sourceFile, ctr, [...ctr.body!.statements, newStatement]);
            }
            else {
                this.insertNodeAfter(sourceFile, lastStatement, newStatement);
            }
        }

        private replaceConstructorBody(sourceFile: SourceFile, ctr: ConstructorDeclaration, statements: ReadonlyArray<Statement>): void {
            this.replaceNode(sourceFile, ctr.body!, createBlock(statements, /*multiLine*/ true));
        }

        public insertNodeAtEndOfScope(sourceFile: SourceFile, scope: Node, newNode: Node): void {
            const pos = getAdjustedStartPosition(sourceFile, scope.getLastToken()!, {}, Position.Start);
            this.replaceRange(sourceFile, { pos, end: pos }, newNode, {
                prefix: isLineBreak(sourceFile.text.charCodeAt(scope.getLastToken()!.pos)) ? this.newLineCharacter : this.newLineCharacter + this.newLineCharacter,
                suffix: this.newLineCharacter
            });
        }

        public insertNodeAtClassStart(sourceFile: SourceFile, cls: ClassLikeDeclaration | InterfaceDeclaration, newElement: ClassElement): void {
            this.insertNodeAtStartWorker(sourceFile, cls, newElement);
        }
        public insertNodeAtObjectStart(sourceFile: SourceFile, obj: ObjectLiteralExpression, newElement: ObjectLiteralElementLike): void {
            this.insertNodeAtStartWorker(sourceFile, obj, newElement);
        }

        private insertNodeAtStartWorker(sourceFile: SourceFile, cls: ClassLikeDeclaration | InterfaceDeclaration | ObjectLiteralExpression, newElement: ClassElement | ObjectLiteralElementLike): void {
            const clsStart = cls.getStart(sourceFile);
            const indentation = formatting.SmartIndenter.findFirstNonWhitespaceColumn(getLineStartPositionForPosition(clsStart, sourceFile), clsStart, sourceFile, this.formatContext.options)
                + this.formatContext.options.indentSize!;
            this.insertNodeAt(sourceFile, getMembersOrProperties(cls).pos, newElement, { indentation, ...this.getInsertNodeAtStartPrefixSuffix(sourceFile, cls) });
        }

        private getInsertNodeAtStartPrefixSuffix(sourceFile: SourceFile, cls: ClassLikeDeclaration | InterfaceDeclaration | ObjectLiteralExpression): { prefix: string, suffix: string } {
            const comma = isObjectLiteralExpression(cls) ? "," : "";
            if (getMembersOrProperties(cls).length === 0) {
                if (addToSeen(this.classesWithNodesInsertedAtStart, getNodeId(cls), { node: cls, sourceFile })) {
                    // For `class C {\n}`, don't add the trailing "\n"
                    const shouldSuffix = (positionsAreOnSameLine as any)(...getClassOrObjectBraceEnds(cls, sourceFile), sourceFile); // TODO: GH#4130 remove 'as any'
                    return { prefix: this.newLineCharacter, suffix: comma + (shouldSuffix ? this.newLineCharacter : "") };
                }
                else {
                    return { prefix: "", suffix: comma + this.newLineCharacter };
                }
            }
            else {
                return { prefix: this.newLineCharacter, suffix: comma };
            }
        }

        public insertNodeAfterComma(sourceFile: SourceFile, after: Node, newNode: Node): void {
            const endPosition = this.insertNodeAfterWorker(sourceFile, this.nextCommaToken(sourceFile, after) || after, newNode);
            this.insertNodeAt(sourceFile, endPosition, newNode, this.getInsertNodeAfterOptions(sourceFile, after));
        }

        public insertNodeAfter(sourceFile: SourceFile, after: Node, newNode: Node): void {
            const endPosition = this.insertNodeAfterWorker(sourceFile, after, newNode);
            this.insertNodeAt(sourceFile, endPosition, newNode, this.getInsertNodeAfterOptions(sourceFile, after));
        }

        public insertNodeAtEndOfList(sourceFile: SourceFile, list: NodeArray<Node>, newNode: Node): void {
            this.insertNodeAt(sourceFile, list.end, newNode, { prefix: ", " });
        }

        public insertNodesAfter(sourceFile: SourceFile, after: Node, newNodes: ReadonlyArray<Node>): void {
            const endPosition = this.insertNodeAfterWorker(sourceFile, after, first(newNodes));
            this.insertNodesAt(sourceFile, endPosition, newNodes, this.getInsertNodeAfterOptions(sourceFile, after));
        }

        private insertNodeAfterWorker(sourceFile: SourceFile, after: Node, newNode: Node): number {
            if (needSemicolonBetween(after, newNode)) {
                // check if previous statement ends with semicolon
                // if not - insert semicolon to preserve the code from changing the meaning due to ASI
                if (sourceFile.text.charCodeAt(after.end - 1) !== CharacterCodes.semicolon) {
                    this.replaceRange(sourceFile, createRange(after.end), createToken(SyntaxKind.SemicolonToken));
                }
            }
            const endPosition = getAdjustedEndPosition(sourceFile, after, {});
            return endPosition;
        }

        private getInsertNodeAfterOptions(sourceFile: SourceFile, after: Node) {
            const options = this.getInsertNodeAfterOptionsWorker(after);
            return {
                ...options,
                prefix: after.end === sourceFile.end && isStatement(after) ? (options.prefix ? `\n${options.prefix}` : "\n") : options.prefix,
            };
        }
        private getInsertNodeAfterOptionsWorker(node: Node): InsertNodeOptions {
            switch (node.kind) {
                case SyntaxKind.ClassDeclaration:
                case SyntaxKind.ModuleDeclaration:
                    return { prefix: this.newLineCharacter, suffix: this.newLineCharacter };

                case SyntaxKind.VariableDeclaration:
                case SyntaxKind.StringLiteral:
                case SyntaxKind.Identifier:
                    return { prefix: ", " };

                case SyntaxKind.PropertyAssignment:
                    return { suffix: "," + this.newLineCharacter };

                case SyntaxKind.ExportKeyword:
                    return { prefix: " " };

                case SyntaxKind.Parameter:
                    return {};

                default:
                    Debug.assert(isStatement(node) || isClassOrTypeElement(node)); // Else we haven't handled this kind of node yet -- add it
                    return { suffix: this.newLineCharacter };
            }
        }

        public insertName(sourceFile: SourceFile, node: FunctionExpression | ClassExpression | ArrowFunction, name: string): void {
            Debug.assert(!node.name);
            if (node.kind === SyntaxKind.ArrowFunction) {
                const arrow = findChildOfKind(node, SyntaxKind.EqualsGreaterThanToken, sourceFile)!;
                const lparen = findChildOfKind(node, SyntaxKind.OpenParenToken, sourceFile);
                if (lparen) {
                    // `() => {}` --> `function f() {}`
                    this.insertNodesAt(sourceFile, lparen.getStart(sourceFile), [createToken(SyntaxKind.FunctionKeyword), createIdentifier(name)], { joiner: " " });
                    deleteNode(this, sourceFile, arrow);
                }
                else {
                    // `x => {}` -> `function f(x) {}`
                    this.insertText(sourceFile, first(node.parameters).getStart(sourceFile), `function ${name}(`);
                    // Replacing full range of arrow to get rid of the leading space -- replace ` =>` with `)`
                    this.replaceRange(sourceFile, arrow, createToken(SyntaxKind.CloseParenToken));
                }

                if (node.body.kind !== SyntaxKind.Block) {
                    // `() => 0` => `function f() { return 0; }`
                    this.insertNodesAt(sourceFile, node.body.getStart(sourceFile), [createToken(SyntaxKind.OpenBraceToken), createToken(SyntaxKind.ReturnKeyword)], { joiner: " ", suffix: " " });
                    this.insertNodesAt(sourceFile, node.body.end, [createToken(SyntaxKind.SemicolonToken), createToken(SyntaxKind.CloseBraceToken)], { joiner: " " });
                }
            }
            else {
                const pos = findChildOfKind(node, node.kind === SyntaxKind.FunctionExpression ? SyntaxKind.FunctionKeyword : SyntaxKind.ClassKeyword, sourceFile)!.end;
                this.insertNodeAt(sourceFile, pos, createIdentifier(name), { prefix: " " });
            }
        }

        public insertExportModifier(sourceFile: SourceFile, node: DeclarationStatement | VariableStatement): void {
            this.insertText(sourceFile, node.getStart(sourceFile), "export ");
        }

        /**
         * This function should be used to insert nodes in lists when nodes don't carry separators as the part of the node range,
         * i.e. arguments in arguments lists, parameters in parameter lists etc.
         * Note that separators are part of the node in statements and class elements.
         */
        public insertNodeInListAfter(sourceFile: SourceFile, after: Node, newNode: Node, containingList = formatting.SmartIndenter.getContainingList(after, sourceFile)) {
            if (!containingList) {
                Debug.fail("node is not a list element");
                return this;
            }
            const index = indexOfNode(containingList, after);
            if (index < 0) {
                return this;
            }
            const end = after.getEnd();
            if (index !== containingList.length - 1) {
                // any element except the last one
                // use next sibling as an anchor
                const nextToken = getTokenAtPosition(sourceFile, after.end);
                if (nextToken && isSeparator(after, nextToken)) {
                    // for list
                    // a, b, c
                    // create change for adding 'e' after 'a' as
                    // - find start of next element after a (it is b)
                    // - use this start as start and end position in final change
                    // - build text of change by formatting the text of node + separator + whitespace trivia of b

                    // in multiline case it will work as
                    //   a,
                    //   b,
                    //   c,
                    // result - '*' denotes leading trivia that will be inserted after new text (displayed as '#')
                    //   a,*
                    // ***insertedtext<separator>#
                    // ###b,
                    //   c,
                    // find line and character of the next element
                    const lineAndCharOfNextElement = getLineAndCharacterOfPosition(sourceFile, skipWhitespacesAndLineBreaks(sourceFile.text, containingList[index + 1].getFullStart()));
                    // find line and character of the token that precedes next element (usually it is separator)
                    const lineAndCharOfNextToken = getLineAndCharacterOfPosition(sourceFile, nextToken.end);
                    let prefix: string | undefined;
                    let startPos: number;
                    if (lineAndCharOfNextToken.line === lineAndCharOfNextElement.line) {
                        // next element is located on the same line with separator:
                        // a,$$$$b
                        //  ^    ^
                        //  |    |-next element
                        //  |-separator
                        // where $$$ is some leading trivia
                        // for a newly inserted node we'll maintain the same relative position comparing to separator and replace leading trivia with spaces
                        // a,    x,$$$$b
                        //  ^    ^     ^
                        //  |    |     |-next element
                        //  |    |-new inserted node padded with spaces
                        //  |-separator
                        startPos = nextToken.end;
                        prefix = spaces(lineAndCharOfNextElement.character - lineAndCharOfNextToken.character);
                    }
                    else {
                        // next element is located on different line that separator
                        // let insert position be the beginning of the line that contains next element
                        startPos = getStartPositionOfLine(lineAndCharOfNextElement.line, sourceFile);
                    }

                    // write separator and leading trivia of the next element as suffix
                    const suffix = `${tokenToString(nextToken.kind)}${sourceFile.text.substring(nextToken.end, containingList[index + 1].getStart(sourceFile))}`;
                    this.replaceRange(sourceFile, createRange(startPos, containingList[index + 1].getStart(sourceFile)), newNode, { prefix, suffix });
                }
            }
            else {
                const afterStart = after.getStart(sourceFile);
                const afterStartLinePosition = getLineStartPositionForPosition(afterStart, sourceFile);

                let separator: SyntaxKind.CommaToken | SyntaxKind.SemicolonToken | undefined;
                let multilineList = false;

                // insert element after the last element in the list that has more than one item
                // pick the element preceding the after element to:
                // - pick the separator
                // - determine if list is a multiline
                if (containingList.length === 1) {
                    // if list has only one element then we'll format is as multiline if node has comment in trailing trivia, or as singleline otherwise
                    // i.e. var x = 1 // this is x
                    //     | new element will be inserted at this position
                    separator = SyntaxKind.CommaToken;
                }
                else {
                    // element has more than one element, pick separator from the list
                    const tokenBeforeInsertPosition = findPrecedingToken(after.pos, sourceFile);
                    separator = isSeparator(after, tokenBeforeInsertPosition) ? tokenBeforeInsertPosition.kind : SyntaxKind.CommaToken;
                    // determine if list is multiline by checking lines of after element and element that precedes it.
                    const afterMinusOneStartLinePosition = getLineStartPositionForPosition(containingList[index - 1].getStart(sourceFile), sourceFile);
                    multilineList = afterMinusOneStartLinePosition !== afterStartLinePosition;
                }
                if (hasCommentsBeforeLineBreak(sourceFile.text, after.end)) {
                    // in this case we'll always treat containing list as multiline
                    multilineList = true;
                }
                if (multilineList) {
                    // insert separator immediately following the 'after' node to preserve comments in trailing trivia
                    this.replaceRange(sourceFile, createRange(end), createToken(separator));
                    // use the same indentation as 'after' item
                    const indentation = formatting.SmartIndenter.findFirstNonWhitespaceColumn(afterStartLinePosition, afterStart, sourceFile, this.formatContext.options);
                    // insert element before the line break on the line that contains 'after' element
                    let insertPos = skipTrivia(sourceFile.text, end, /*stopAfterLineBreak*/ true, /*stopAtComments*/ false);
                    if (insertPos !== end && isLineBreak(sourceFile.text.charCodeAt(insertPos - 1))) {
                        insertPos--;
                    }
                    this.replaceRange(sourceFile, createRange(insertPos), newNode, { indentation, prefix: this.newLineCharacter });
                }
                else {
                    this.replaceRange(sourceFile, createRange(end), newNode, { prefix: `${tokenToString(separator)} ` });
                }
            }
            return this;
        }

        private finishClassesWithNodesInsertedAtStart(): void {
            this.classesWithNodesInsertedAtStart.forEach(({ node, sourceFile }) => {
                const [openBraceEnd, closeBraceEnd] = getClassOrObjectBraceEnds(node, sourceFile);
                // For `class C { }` remove the whitespace inside the braces.
                if (positionsAreOnSameLine(openBraceEnd, closeBraceEnd, sourceFile) && openBraceEnd !== closeBraceEnd - 1) {
                    this.deleteRange(sourceFile, createRange(openBraceEnd, closeBraceEnd - 1));
                }
            });
        }

        private finishDeleteDeclarations(): void {
            const deletedNodesInLists = new NodeSet(); // Stores ids of nodes in lists that we already deleted. Used to avoid deleting `, ` twice in `a, b`.
            for (const { sourceFile, node } of this.deletedNodes) {
                if (!this.deletedNodes.some(d => d.sourceFile === sourceFile && rangeContainsRangeExclusive(d.node, node))) {
                    if (isArray(node)) {
                        this.deleteRange(sourceFile, rangeOfTypeParameters(node));
                    }
                    else {
                        deleteDeclaration.deleteDeclaration(this, deletedNodesInLists, sourceFile, node);
                    }
                }
            }

            deletedNodesInLists.forEach(node => {
                const sourceFile = node.getSourceFile();
                const list = formatting.SmartIndenter.getContainingList(node, sourceFile)!;
                if (node !== last(list)) return;

                const lastNonDeletedIndex = findLastIndex(list, n => !deletedNodesInLists.has(n), list.length - 2);
                if (lastNonDeletedIndex !== -1) {
                    this.deleteRange(sourceFile, { pos: list[lastNonDeletedIndex].end, end: startPositionToDeleteNodeInList(sourceFile, list[lastNonDeletedIndex + 1]) });
                }
            });
        }

        /**
         * Note: after calling this, the TextChanges object must be discarded!
         * @param validate only for tests
         *    The reason we must validate as part of this method is that `getNonFormattedText` changes the node's positions,
         *    so we can only call this once and can't get the non-formatted text separately.
         */
        public getChanges(validate?: ValidateNonFormattedText): FileTextChanges[] {
            this.finishDeleteDeclarations();
            this.finishClassesWithNodesInsertedAtStart();
            const changes = changesToText.getTextChangesFromChanges(this.changes, this.newLineCharacter, this.formatContext, validate);
            for (const { oldFile, fileName, statements } of this.newFiles) {
                changes.push(changesToText.newFileChanges(oldFile, fileName, statements, this.newLineCharacter, this.formatContext));
            }
            return changes;
        }

        public createNewFile(oldFile: SourceFile | undefined, fileName: string, statements: ReadonlyArray<Statement>) {
            this.newFiles.push({ oldFile, fileName, statements });
        }
    }

    // find first non-whitespace position in the leading trivia of the node
    function startPositionToDeleteNodeInList(sourceFile: SourceFile, node: Node): number {
        return skipTrivia(sourceFile.text, getAdjustedStartPosition(sourceFile, node, {}, Position.FullStart), /*stopAfterLineBreak*/ false, /*stopAtComments*/ true);
    }

    function getClassOrObjectBraceEnds(cls: ClassLikeDeclaration | InterfaceDeclaration | ObjectLiteralExpression, sourceFile: SourceFile): [number, number] {
        return [findChildOfKind(cls, SyntaxKind.OpenBraceToken, sourceFile)!.end, findChildOfKind(cls, SyntaxKind.CloseBraceToken, sourceFile)!.end];
    }
    function getMembersOrProperties(cls: ClassLikeDeclaration | InterfaceDeclaration | ObjectLiteralExpression): NodeArray<Node> {
        return isObjectLiteralExpression(cls) ? cls.properties : cls.members;
    }

    export type ValidateNonFormattedText = (node: Node, text: string) => void;

    export function getNewFileText(statements: ReadonlyArray<Statement>, scriptKind: ScriptKind, newLineCharacter: string, formatContext: formatting.FormatContext): string {
        return changesToText.newFileChangesWorker(/*oldFile*/ undefined, scriptKind, statements, newLineCharacter, formatContext);
    }

    namespace changesToText {
        export function getTextChangesFromChanges(changes: ReadonlyArray<Change>, newLineCharacter: string, formatContext: formatting.FormatContext, validate: ValidateNonFormattedText | undefined): FileTextChanges[] {
            return group(changes, c => c.sourceFile.path).map(changesInFile => {
                const sourceFile = changesInFile[0].sourceFile;
                // order changes by start position
                // If the start position is the same, put the shorter range first, since an empty range (x, x) may precede (x, y) but not vice-versa.
                const normalized = stableSort(changesInFile, (a, b) => (a.range.pos - b.range.pos) || (a.range.end - b.range.end));
                // verify that change intervals do not overlap, except possibly at end points.
                for (let i = 0; i < normalized.length - 1; i++) {
                    Debug.assert(normalized[i].range.end <= normalized[i + 1].range.pos, "Changes overlap", () =>
                        `${JSON.stringify(normalized[i].range)} and ${JSON.stringify(normalized[i + 1].range)}`);
                }
                const textChanges = normalized.map(c =>
                    createTextChange(createTextSpanFromRange(c.range), computeNewText(c, sourceFile, newLineCharacter, formatContext, validate)));
                return { fileName: sourceFile.fileName, textChanges };
            });
        }

        export function newFileChanges(oldFile: SourceFile | undefined, fileName: string, statements: ReadonlyArray<Statement>, newLineCharacter: string, formatContext: formatting.FormatContext): FileTextChanges {
            const text = newFileChangesWorker(oldFile, getScriptKindFromFileName(fileName), statements, newLineCharacter, formatContext);
            return { fileName, textChanges: [createTextChange(createTextSpan(0, 0), text)], isNewFile: true };
        }

        export function newFileChangesWorker(oldFile: SourceFile | undefined, scriptKind: ScriptKind, statements: ReadonlyArray<Statement>, newLineCharacter: string, formatContext: formatting.FormatContext): string {
            // TODO: this emits the file, parses it back, then formats it that -- may be a less roundabout way to do this
            const nonFormattedText = statements.map(s => getNonformattedText(s, oldFile, newLineCharacter).text).join(newLineCharacter);
            const sourceFile = createSourceFile("any file name", nonFormattedText, ScriptTarget.ESNext, /*setParentNodes*/ true, scriptKind);
            const changes = formatting.formatDocument(sourceFile, formatContext);
            return applyChanges(nonFormattedText, changes);
        }

        function computeNewText(change: Change, sourceFile: SourceFile, newLineCharacter: string, formatContext: formatting.FormatContext, validate: ValidateNonFormattedText | undefined): string {
            if (change.kind === ChangeKind.Remove) {
                return "";
            }
            if (change.kind === ChangeKind.Text) {
                return change.text;
            }

            const { options = {}, range: { pos } } = change;
            const format = (n: Node) => getFormattedTextOfNode(n, sourceFile, pos, options, newLineCharacter, formatContext, validate);
            const text = change.kind === ChangeKind.ReplaceWithMultipleNodes
                ? change.nodes.map(n => removeSuffix(format(n), newLineCharacter)).join(change.options!.joiner || newLineCharacter) // TODO: GH#18217
                : format(change.node);
            // strip initial indentation (spaces or tabs) if text will be inserted in the middle of the line
            const noIndent = (options.preserveLeadingWhitespace || options.indentation !== undefined || getLineStartPositionForPosition(pos, sourceFile) === pos) ? text : text.replace(/^\s+/, "");
            return (options.prefix || "") + noIndent + (options.suffix || "");
        }

        /** Note: this may mutate `nodeIn`. */
        function getFormattedTextOfNode(nodeIn: Node, sourceFile: SourceFile, pos: number, { indentation, prefix, delta }: InsertNodeOptions, newLineCharacter: string, formatContext: formatting.FormatContext, validate: ValidateNonFormattedText | undefined): string {
            const { node, text } = getNonformattedText(nodeIn, sourceFile, newLineCharacter);
            if (validate) validate(node, text);
            const { options: formatOptions } = formatContext;
            const initialIndentation =
                indentation !== undefined
                    ? indentation
                    : formatting.SmartIndenter.getIndentation(pos, sourceFile, formatOptions, prefix === newLineCharacter || getLineStartPositionForPosition(pos, sourceFile) === pos);
            if (delta === undefined) {
                delta = formatting.SmartIndenter.shouldIndentChildNode(formatContext.options, nodeIn) ? (formatOptions.indentSize || 0) : 0;
            }

            const file: SourceFileLike = { text, getLineAndCharacterOfPosition(pos) { return getLineAndCharacterOfPosition(this, pos); } };
            const changes = formatting.formatNodeGivenIndentation(node, file, sourceFile.languageVariant, initialIndentation, delta, formatContext);
            return applyChanges(text, changes);
        }

        /** Note: output node may be mutated input node. */
        function getNonformattedText(node: Node, sourceFile: SourceFile | undefined, newLineCharacter: string): { text: string, node: Node } {
            const writer = new Writer(newLineCharacter);
            const newLine = newLineCharacter === "\n" ? NewLineKind.LineFeed : NewLineKind.CarriageReturnLineFeed;
            createPrinter({ newLine, neverAsciiEscape: true }, writer).writeNode(EmitHint.Unspecified, node, sourceFile, writer);
            return { text: writer.getText(), node: assignPositionsToNode(node) };
        }
    }

    export function applyChanges(text: string, changes: ReadonlyArray<TextChange>): string {
        for (let i = changes.length - 1; i >= 0; i--) {
            const { span, newText } = changes[i];
            text = `${text.substring(0, span.start)}${newText}${text.substring(textSpanEnd(span))}`;
        }
        return text;
    }

    function isTrivia(s: string) {
        return skipTrivia(s, 0) === s.length;
    }

    function assignPositionsToNode(node: Node): Node {
        const visited = visitEachChild(node, assignPositionsToNode, nullTransformationContext, assignPositionsToNodeArray, assignPositionsToNode)!; // TODO: GH#18217
        // create proxy node for non synthesized nodes
        const newNode = nodeIsSynthesized(visited) ? visited : Object.create(visited) as Node;
        newNode.pos = getPos(node);
        newNode.end = getEnd(node);
        return newNode;
    }

    function assignPositionsToNodeArray(nodes: NodeArray<any>, visitor: Visitor, test?: (node: Node) => boolean, start?: number, count?: number) {
        const visited = visitNodes(nodes, visitor, test, start, count);
        if (!visited) {
            return visited;
        }
        // clone nodearray if necessary
        const nodeArray = visited === nodes ? createNodeArray(visited.slice(0)) : visited;
        nodeArray.pos = getPos(nodes);
        nodeArray.end = getEnd(nodes);
        return nodeArray;
    }

    class Writer implements EmitTextWriter, PrintHandlers {
        private lastNonTriviaPosition = 0;
        private readonly writer: EmitTextWriter;

        public readonly onEmitNode: PrintHandlers["onEmitNode"];
        public readonly onBeforeEmitNodeArray: PrintHandlers["onBeforeEmitNodeArray"];
        public readonly onAfterEmitNodeArray: PrintHandlers["onAfterEmitNodeArray"];
        public readonly onBeforeEmitToken: PrintHandlers["onBeforeEmitToken"];
        public readonly onAfterEmitToken: PrintHandlers["onAfterEmitToken"];

        constructor(newLine: string) {
            this.writer = createTextWriter(newLine);
            this.onEmitNode = (hint, node, printCallback) => {
                if (node) {
                    setPos(node, this.lastNonTriviaPosition);
                }
                printCallback(hint, node);
                if (node) {
                    setEnd(node, this.lastNonTriviaPosition);
                }
            };
            this.onBeforeEmitNodeArray = nodes => {
                if (nodes) {
                    setPos(nodes, this.lastNonTriviaPosition);
                }
            };
            this.onAfterEmitNodeArray = nodes => {
                if (nodes) {
                    setEnd(nodes, this.lastNonTriviaPosition);
                }
            };
            this.onBeforeEmitToken = node => {
                if (node) {
                    setPos(node, this.lastNonTriviaPosition);
                }
            };
            this.onAfterEmitToken = node => {
                if (node) {
                    setEnd(node, this.lastNonTriviaPosition);
                }
            };
        }

        private setLastNonTriviaPosition(s: string, force: boolean) {
            if (force || !isTrivia(s)) {
                this.lastNonTriviaPosition = this.writer.getTextPos();
                let i = 0;
                while (isWhiteSpaceLike(s.charCodeAt(s.length - i - 1))) {
                    i++;
                }
                // trim trailing whitespaces
                this.lastNonTriviaPosition -= i;
            }
        }

        write(s: string): void {
            this.writer.write(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeKeyword(s: string): void {
            this.writer.writeKeyword(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeOperator(s: string): void {
            this.writer.writeOperator(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writePunctuation(s: string): void {
            this.writer.writePunctuation(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeParameter(s: string): void {
            this.writer.writeParameter(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeProperty(s: string): void {
            this.writer.writeProperty(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeSpace(s: string): void {
            this.writer.writeSpace(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeStringLiteral(s: string): void {
            this.writer.writeStringLiteral(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeSymbol(s: string, sym: Symbol): void {
            this.writer.writeSymbol(s, sym);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeTextOfNode(text: string, node: Node): void {
            this.writer.writeTextOfNode(text, node);
        }
        writeLine(): void {
            this.writer.writeLine();
        }
        increaseIndent(): void {
            this.writer.increaseIndent();
        }
        decreaseIndent(): void {
            this.writer.decreaseIndent();
        }
        getText(): string {
            return this.writer.getText();
        }
        rawWrite(s: string): void {
            this.writer.rawWrite(s);
            this.setLastNonTriviaPosition(s, /*force*/ false);
        }
        writeLiteral(s: string): void {
            this.writer.writeLiteral(s);
            this.setLastNonTriviaPosition(s, /*force*/ true);
        }
        getTextPos(): number {
            return this.writer.getTextPos();
        }
        getLine(): number {
            return this.writer.getLine();
        }
        getColumn(): number {
            return this.writer.getColumn();
        }
        getIndent(): number {
            return this.writer.getIndent();
        }
        isAtStartOfLine(): boolean {
            return this.writer.isAtStartOfLine();
        }
        clear(): void {
            this.writer.clear();
            this.lastNonTriviaPosition = 0;
        }
    }

    function getInsertionPositionAtSourceFileTop({ text }: SourceFile): number {
        const shebang = getShebang(text);
        let position = 0;
        if (shebang !== undefined) {
            position = shebang.length;
            advancePastLineBreak();
        }

        // For a source file, it is possible there are detached comments we should not skip
        let ranges = getLeadingCommentRanges(text, position);
        if (!ranges) return position;
        // However we should still skip a pinned comment at the top
        if (ranges.length && ranges[0].kind === SyntaxKind.MultiLineCommentTrivia && isPinnedComment(text, ranges[0].pos)) {
            position = ranges[0].end;
            advancePastLineBreak();
            ranges = ranges.slice(1);
        }
        // As well as any triple slash references
        for (const range of ranges) {
            if (range.kind === SyntaxKind.SingleLineCommentTrivia && isRecognizedTripleSlashComment(text, range.pos, range.end)) {
                position = range.end;
                advancePastLineBreak();
                continue;
            }
            break;
        }
        return position;

        function advancePastLineBreak() {
            if (position < text.length) {
                const charCode = text.charCodeAt(position);
                if (isLineBreak(charCode)) {
                    position++;

                    if (position < text.length && charCode === CharacterCodes.carriageReturn && text.charCodeAt(position) === CharacterCodes.lineFeed) {
                        position++;
                    }
                }
            }
        }
    }

    export function isValidLocationToAddComment(sourceFile: SourceFile, position: number) {
        return !isInComment(sourceFile, position) && !isInString(sourceFile, position) && !isInTemplateString(sourceFile, position);
    }

    function needSemicolonBetween(a: Node, b: Node): boolean {
        return (isPropertySignature(a) || isPropertyDeclaration(a)) && isClassOrTypeElement(b) && b.name!.kind === SyntaxKind.ComputedPropertyName
            || isStatementButNotDeclaration(a) && isStatementButNotDeclaration(b); // TODO: only if b would start with a `(` or `[`
    }

    namespace deleteDeclaration {
        export function deleteDeclaration(changes: ChangeTracker, deletedNodesInLists: NodeSet<Node>, sourceFile: SourceFile, node: Node): void {
            switch (node.kind) {
                case SyntaxKind.Parameter: {
                    const oldFunction = node.parent;
                    if (isArrowFunction(oldFunction) && oldFunction.parameters.length === 1) {
                        // Lambdas with exactly one parameter are special because, after removal, there
                        // must be an empty parameter list (i.e. `()`) and this won't necessarily be the
                        // case if the parameter is simply removed (e.g. in `x => 1`).
                        const newFunction = updateArrowFunction(
                            oldFunction,
                            oldFunction.modifiers,
                            oldFunction.typeParameters,
                            /*parameters*/ undefined!, // TODO: GH#18217
                            oldFunction.type,
                            oldFunction.equalsGreaterThanToken,
                            oldFunction.body);

                        // Drop leading and trailing trivia of the new function because we're only going
                        // to replace the span (vs the full span) of the old function - the old leading
                        // and trailing trivia will remain.
                        suppressLeadingAndTrailingTrivia(newFunction);

                        changes.replaceNode(sourceFile, oldFunction, newFunction);
                    }
                    else {
                        deleteNodeInList(changes, deletedNodesInLists, sourceFile, node);
                    }
                    break;
                }

                case SyntaxKind.ImportDeclaration:
                    deleteNode(changes, sourceFile, node,
                        // For first import, leave header comment in place
                        node === sourceFile.imports[0].parent ? { useNonAdjustedStartPosition: true, useNonAdjustedEndPosition: false } : undefined);
                    break;

                case SyntaxKind.BindingElement:
                    const pattern = (node as BindingElement).parent;
                    const preserveComma = pattern.kind === SyntaxKind.ArrayBindingPattern && node !== last(pattern.elements);
                    if (preserveComma) {
                        deleteNode(changes, sourceFile, node);
                    }
                    else {
                        deleteNodeInList(changes, deletedNodesInLists, sourceFile, node);
                    }
                    break;

                case SyntaxKind.VariableDeclaration:
                    deleteVariableDeclaration(changes, deletedNodesInLists, sourceFile, node as VariableDeclaration);
                    break;

                case SyntaxKind.TypeParameter:
                    deleteNodeInList(changes, deletedNodesInLists, sourceFile, node);
                    break;

                case SyntaxKind.ImportSpecifier:
                    const namedImports = (node as ImportSpecifier).parent;
                    if (namedImports.elements.length === 1) {
                        deleteImportBinding(changes, sourceFile, namedImports);
                    }
                    else {
                        deleteNodeInList(changes, deletedNodesInLists, sourceFile, node);
                    }
                    break;

                case SyntaxKind.NamespaceImport:
                    deleteImportBinding(changes, sourceFile, node as NamespaceImport);
                    break;

                default:
                    if (isImportClause(node.parent) && node.parent.name === node) {
                        deleteDefaultImport(changes, sourceFile, node.parent);
                    }
                    else if (isCallLikeExpression(node.parent)) {
                        deleteNodeInList(changes, deletedNodesInLists, sourceFile, node);
                    }
                    else {
                        deleteNode(changes, sourceFile, node, node.kind === SyntaxKind.SemicolonToken ? { useNonAdjustedEndPosition: true } : undefined);
                    }
            }
        }

        function deleteDefaultImport(changes: ChangeTracker, sourceFile: SourceFile, importClause: ImportClause): void {
            if (!importClause.namedBindings) {
                // Delete the whole import
                deleteNode(changes, sourceFile, importClause.parent);
            }
            else {
                // import |d,| * as ns from './file'
                const start = importClause.name!.getStart(sourceFile);
                const nextToken = getTokenAtPosition(sourceFile, importClause.name!.end);
                if (nextToken && nextToken.kind === SyntaxKind.CommaToken) {
                    // shift first non-whitespace position after comma to the start position of the node
                    const end = skipTrivia(sourceFile.text, nextToken.end, /*stopAfterLineBreaks*/ false, /*stopAtComments*/ true);
                    changes.deleteRange(sourceFile, { pos: start, end });
                }
                else {
                    deleteNode(changes, sourceFile, importClause.name!);
                }
            }
        }

        function deleteImportBinding(changes: ChangeTracker, sourceFile: SourceFile, node: NamedImportBindings): void {
            if (node.parent.name) {
                // Delete named imports while preserving the default import
                // import d|, * as ns| from './file'
                // import d|, { a }| from './file'
                const previousToken = Debug.assertDefined(getTokenAtPosition(sourceFile, node.pos - 1));
                changes.deleteRange(sourceFile, { pos: previousToken.getStart(sourceFile), end: node.end });
            }
            else {
                // Delete the entire import declaration
                // |import * as ns from './file'|
                // |import { a } from './file'|
                const importDecl = getAncestor(node, SyntaxKind.ImportDeclaration)!;
                deleteNode(changes, sourceFile, importDecl);
            }
        }

        function deleteVariableDeclaration(changes: ChangeTracker, deletedNodesInLists: NodeSet<Node>, sourceFile: SourceFile, node: VariableDeclaration): void {
            const { parent } = node;

            if (parent.kind === SyntaxKind.CatchClause) {
                // TODO: There's currently no unused diagnostic for this, could be a suggestion
                changes.deleteNodeRange(sourceFile, findChildOfKind(parent, SyntaxKind.OpenParenToken, sourceFile)!, findChildOfKind(parent, SyntaxKind.CloseParenToken, sourceFile)!);
                return;
            }

            if (parent.declarations.length !== 1) {
                deleteNodeInList(changes, deletedNodesInLists, sourceFile, node);
                return;
            }

            const gp = parent.parent;
            switch (gp.kind) {
                case SyntaxKind.ForOfStatement:
                case SyntaxKind.ForInStatement:
                    changes.replaceNode(sourceFile, node, createObjectLiteral());
                    break;

                case SyntaxKind.ForStatement:
                    deleteNode(changes, sourceFile, parent);
                    break;

                case SyntaxKind.VariableStatement:
                    deleteNode(changes, sourceFile, gp);
                    break;

                default:
                    Debug.assertNever(gp);
            }
        }
    }

    /** Warning: This deletes comments too. See `copyComments` in `convertFunctionToEs6Class`. */
    // Exported for tests only! (TODO: improve tests to not need this)
    export function deleteNode(changes: ChangeTracker, sourceFile: SourceFile, node: Node, options: ConfigurableStartEnd = {}): void {
        const startPosition = getAdjustedStartPosition(sourceFile, node, options, Position.FullStart);
        const endPosition = getAdjustedEndPosition(sourceFile, node, options);
        changes.deleteRange(sourceFile, { pos: startPosition, end: endPosition });
    }

    function deleteNodeInList(changes: ChangeTracker, deletedNodesInLists: NodeSet<Node>, sourceFile: SourceFile, node: Node): void {
        const containingList = Debug.assertDefined(formatting.SmartIndenter.getContainingList(node, sourceFile));
        const index = indexOfNode(containingList, node);
        Debug.assert(index !== -1);
        if (containingList.length === 1) {
            deleteNode(changes, sourceFile, node);
            return;
        }

        // Note: We will only delete a comma *after* a node. This will leave a trailing comma if we delete the last node.
        // That's handled in the end by `finishTrailingCommaAfterDeletingNodesInList`.
        Debug.assert(!deletedNodesInLists.has(node), "Deleting a node twice");
        deletedNodesInLists.add(node);
        changes.deleteRange(sourceFile, {
            pos: startPositionToDeleteNodeInList(sourceFile, node),
            end: index === containingList.length - 1 ? getAdjustedEndPosition(sourceFile, node, {}) : startPositionToDeleteNodeInList(sourceFile, containingList[index + 1]),
        });
    }
}
