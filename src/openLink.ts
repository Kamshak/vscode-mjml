"use strict";

import * as vscode from "vscode";
import * as path from 'path';

export interface OpenDocumentLinkArgs {
	path: string;
	fragment: string;
}

export default class OpenDocumentLink {
    private static readonly id = '_mjml.openDocumentLink';
	public readonly id = OpenDocumentLink.id;

	public static createCommandUri(
		path: string,
		fragment: string
	): vscode.Uri {
		return vscode.Uri.parse(`command:${OpenDocumentLink.id}?${encodeURIComponent(JSON.stringify({ path, fragment }))}`);
	}


    constructor(subscriptions: vscode.Disposable[]) {
        subscriptions.push(vscode.commands.registerCommand(this.id, this.execute, this));
    }

    public execute(args: OpenDocumentLinkArgs) {
		const p = decodeURIComponent(args.path);
		return this.tryOpen(p, args).catch(() => {
			if (path.extname(p) === '') {
				return this.tryOpen(p + '.mjml', args);
			}
			const resource = vscode.Uri.file(p);
			return Promise.resolve(void 0)
				.then(() => vscode.commands.executeCommand('vscode.open', resource))
				.then(() => void 0);
		});
	}

	private async tryOpen(path: string, args: OpenDocumentLinkArgs) {
		const resource = vscode.Uri.file(path);
		if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath === resource.fsPath) {
            await this.tryRevealLine(vscode.window.activeTextEditor, args.fragment);
		} else {
            const doc = await vscode.workspace.openTextDocument(resource);
            const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
            await this.tryRevealLine(editor, args.fragment)
		}
	}
    
	private async tryRevealLine(editor: vscode.TextEditor, fragment?: string) {
        if (editor && fragment) {
            const lineNumberFragment = fragment.match(/^L(\d+)$/i);
            if (lineNumberFragment) {
                const line = +lineNumberFragment[1] - 1;
                if (!isNaN(line)) {
                    await editor.revealRange(new vscode.Range(line, 0, line, 0));
                }
            }
		}
	}
}
