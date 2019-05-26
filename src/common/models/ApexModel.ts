import * as tags from '../tags';
import ApexDoc from '../../engine/ApexDoc';
import Utils, { Option } from '../Utils';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { window, workspace, WorkspaceFolder } from 'vscode';

abstract class ApexModel {

    protected _annotations: string[] = [];
    protected _author: string = '';
    protected _deprecated: string = '';
    protected _description: string = '';
    protected _example: string = '';
    protected _exception: string = '';
    protected _groupContentPath: string = '';
    protected _groupName: string = '';
    protected _lineNum: number = 0;
    protected _nameLine: string = '';
    protected _params: string[] = [];
    protected _returns: string = '';
    protected _scope: string = '';
    protected _see: string[] = [];
    protected _since: string = '';
    protected _sourceUrl?: string;

    protected constructor(comments: string[], sourceUrl: Option<string>) {
        this.parseComments(comments);
        this._sourceUrl = sourceUrl;
    }

    public abstract get name(): string;

    public get annotations(): string[] {
        return this._annotations;
    }

    public get description(): string {
        return this._description;
    }

    public get lineNum(): number {
        return this._lineNum;
    }

    public get nameLine(): string {
        return this._nameLine;
    }

    public get scope(): string {
        return this._scope;
    }

    public get sourceUrl(): Option<string> {
        return this._sourceUrl;
    }

    private parseComments(comments: string[]): void {
        let currBlock: Option<string, null> = null;
        let block: Option<string, null> = null;

        for (let comment of comments) {
            let newBlock = false, isBreak = false;
            let lowerComment = comment.toLowerCase();
            let i: number;

            // skip lines that are just opening or closing comment blocks
            if (comment.trim() === '/**' || comment.trim() === '*/') {
                continue;
            }

            // if we find a tag, start a new block
            if (((i = lowerComment.indexOf(block = tags.AUTHOR.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.SINCE.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.SEE.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.RETURNS.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.PARAM.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.EXCEPTION.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.DEPRECATED.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.DESCRIPTION.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.GROUP.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.GROUP_CONTENT.label)) >= 0)
                || ((i = lowerComment.indexOf(block = tags.EXAMPLE.label)) >= 0)) {

                comment = comment.substring(i + block.length);
                currBlock = block;
                newBlock = true;
            }

            // get everything after opening '*'s
            let line = '';
            comment = comment.trim();
            for (let j = 0; j < comment.length; ++j) {
                let ch = comment.charAt(j);
                // skip the '/' of the opening
                // block so comment is trimmed correctly
                if (ch === '/' && j === 0) {
                    continue;
                }

                if (ch !== '*') {
                    line = comment.slice(j);
                    break;
                }
            }

            // replace docBlock break marker and indicate we should break after
            // this round. Otherwise we may get some strange behavior due to
            // multi-line support and this common parser for all models
            if (line.includes(ApexDoc.DOC_BLOCK_BREAK)) {
                line = line.replace(ApexDoc.DOC_BLOCK_BREAK, '');
                isBreak = true;
            }

            // add line to appropriate block...
            // if currBlock was not reset on this iteration we're on the next line of the last tag, add line
            // to that value. Allow empty lines in @example blocks to preserve whitespace in complex examples
            if (currBlock !== null && (line.trim() || !line.trim() && currBlock === tags.EXAMPLE.label)) {
                if (currBlock === tags.AUTHOR.label) {
                    this._author += (this._author ? ' ' : '') + line.trim();
                } else if (currBlock === tags.SINCE.label) {
                    this._since += (this._since ? ' ' : '') + line.trim();
                } else if (currBlock === tags.SEE.label) {
                    this._see.push(line.trim());
                } else if (currBlock === tags.RETURNS.label) {
                    this._returns += (this._returns ? ' ' : '') + line.trim();
                } else if (currBlock === tags.PARAM.label) {
                    let p = (newBlock ? '' : this._params.pop());
                    this._params.push(p + (p && p.length > 0 ? ' ' : '') + line.trim());
                } else if (currBlock === tags.EXCEPTION.label) {
                    this._exception += (this._exception ? ' ' : '') + line.trim();
                } else if (currBlock === tags.DEPRECATED.label) {
                    this._deprecated += (this._deprecated ? ' ' : '') + line.trim();
                } else if (currBlock === tags.DESCRIPTION.label) {
                    this._description += (this._description ? ' ' : '') + line.trim();
                } else if (currBlock === tags.EXAMPLE.label) {
                    this._example += (this._example ? ' \n'  : '') + line;
                }
                // These tags only support a single line if a duplicate
                // tag is encountered, override any existing value.
                else if (currBlock === tags.GROUP.label) {
                    this._groupName = line.trim();
                } else if (currBlock === tags.GROUP_CONTENT.label) {
                    const doesResolve = this.resolveContentPath(line.trim());
                    if (doesResolve) {
                        this._groupContentPath = doesResolve;
                    }
                }
            }
            // not a recognized tag, assume we're in un-tagged _description
            else if (currBlock === null && line.trim()) {
                currBlock = block = tags.DESCRIPTION.label;
                this._description += (this._description ? ' ' : '') + line.trim();
            } else if (!line.trim()) {
                currBlock = null;
            }

            if (isBreak) {
                break;
            }
        }
    }

    public static parseAnnotations(previousLine: Option<string, null>, line: string, model: ApexModel): void {
        // If previous line is not a comment line, it could be an annotation line.
        // Annotations may also be on the signature line, so check both for matches.
        if (previousLine) {
            previousLine = previousLine.trim();
            if (!previousLine.startsWith('*') && /.*(@\w+\s*(\([\w=.*''/\s]+\))?)$/.test(previousLine)) {
                line = previousLine + ' ' + line;
            }
        }

        let matches: Option<RegExpMatchArray, null> = line.match(/@\w+\s*(\([\w=.*''/\s]+\))?/g);

        if (matches !== null) {
            matches.forEach(match => {
                if (match) {
                    model && model.annotations.push(match.trim());
                }
            });
        }
    }

    protected parseScope(): void {
        if (this._nameLine) {
            let _scope = Utils.containsScope(this._nameLine);
            if (_scope) {
                this._scope = _scope;
            } else {
                // _scope is implicitly private
                this._scope = ApexDoc.PRIVATE;
            }
        }
    }

    // TODO: update README about where content path is relative to
    private resolveContentPath(contentPath: string): Option<string, null> {
        // If running this tool, workspace folders should always exist, okay to cast.
        const projectRoot = (<WorkspaceFolder[]>workspace.workspaceFolders)[0].uri.fsPath;
        const path = resolve(projectRoot, contentPath.trim());

        if (contentPath.trim().endsWith('.html') && existsSync(path)) {
            return path;
        }

        const warningMessage =
            `@group-content path '${contentPath.trim()}' in file '${ApexDoc.currentFile}' is invalid! ` +
            `You may want to update this tag's value to a valid HTML file path.`;

        window.showWarningMessage(warningMessage);
        return null;
    }

    protected setNameLine(_nameLine: string, _lineNum: number): void {
        // strip any _annotations from the signature line
        // we'll capture those and display them separately
        this._nameLine = Utils.stripAnnotations(_nameLine).trim();
        this._lineNum = _lineNum;
        // if we're running the stub command
        // we don't care about _scope
        if (!ApexDoc.isStub) {
            this.parseScope();
        }
    }
}

export { ApexModel };