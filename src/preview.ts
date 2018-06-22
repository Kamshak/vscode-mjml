"use strict";

import * as vscode from "vscode";
import * as nunjucks from "nunjucks";

import helper from "./helper";
import OpenDocumentLink from "./openLink";
const Template = nunjucks.Template as any;

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }

export default class PreviewManager {

    private IDMap: IDMap = new IDMap();
    private fileMap: Map<string, MJMLView> = new Map<string, MJMLView>();
    private subscriptions: vscode.Disposable[];
    private previewOpen: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.subscriptions = context.subscriptions;

        this.subscriptions.push(
            vscode.commands.registerCommand("mjml.previewToSide", () => {
                this.previewOpen = true;
                this.previewCommand();
            }),

            vscode.workspace.onDidOpenTextDocument((document?: vscode.TextDocument) => {
                if (vscode.workspace.getConfiguration("mjml").autoPreview) {
                    if (document) {
                        if (this.previewOpen && document.languageId == "mjml") {
                            this.previewCommand(document);
                        }
                        else if (document.fileName.replace(/\\/g, "/") == "/mjml-preview/sidebyside/") {
                            this.previewOpen = true;
                        }
                    }
                }
            }),

            vscode.window.onDidChangeActiveTextEditor((editor?: vscode.TextEditor) => {
                if (vscode.workspace.getConfiguration("mjml").autoPreview) {
                    if (editor) {
                        if (this.previewOpen && editor.document.languageId == "mjml") {
                            this.previewCommand(editor.document);
                        }
                    }
                }
            }),

            vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
                if (document.fileName.replace(/\\/g, "/") == "/mjml-preview/sidebyside/") {
                    this.previewOpen = false;
                }
                else {
                    this.removePreview(document);
                }
            })
        );
    }

    private previewCommand(document?: vscode.TextDocument): void {
        let documentURI: string = this.IDMap.createDocumentUri(((document) ? document.uri : vscode.window.activeTextEditor.document.uri));

        let mjmlPreview: MJMLView;
        if (!this.IDMap.hasUri(documentURI)) {
            mjmlPreview = new MJMLView(((document) ? document : vscode.window.activeTextEditor.document));

            this.fileMap.set(this.IDMap.add(documentURI, mjmlPreview.uri), mjmlPreview);
        }
        else {
            mjmlPreview = this.fileMap.get(this.IDMap.getByUri(documentURI));
        }

        mjmlPreview.execute();
    }

    private removePreview(document: vscode.TextDocument): void {
        if (/mjml-preview/.test(document.fileName) && /sidebyside/.test(document.fileName)) {
            this.dispose();
            this.fileMap.clear();
            this.IDMap.clear();
        }
        else {
            let documentURI: string = this.IDMap.createDocumentUri(document.uri);

            if (this.IDMap.hasUri(documentURI)) {
                let mjmlPreview: MJMLView = this.fileMap.get(this.IDMap.getByUri(documentURI));

                let id: string = this.IDMap.delete(documentURI, mjmlPreview.uri);
                this.dispose(id);
                this.fileMap.delete(id);
            }
        }
    }

    public dispose(id?: string): void {
        let values: IterableIterator<MJMLView> = this.fileMap.values();
        let value: IteratorResult<MJMLView> = values.next();

        if (id && this.fileMap.has(id)) {
            this.fileMap.get(id).dispose();
        }
        else {
            while (!value.done) {
                value.value.dispose();
                value = values.next();
            }
        }
    }

}

class MJMLView {

    private subscriptions: vscode.Disposable[] = [];
    private document: vscode.TextDocument;
    private provider: PreviewContentProvider;
    private previewUri: vscode.Uri;
    private viewColumn: vscode.ViewColumn;
    private label: string;
    private env = nunjucks.configure({ autoescape: true, throwOnUndefined: true, watch: false, dev: false } as any);


    constructor(document: vscode.TextDocument) {
        this.document = document;
        this.provider = new PreviewContentProvider(this.document, this.env);

        this.previewUri = this.createUri(document.uri);
        this.viewColumn = vscode.ViewColumn.Two;

        this.label = "MJML Preview";

        this.registerEvents();
    }

    private registerEvents(): void {
        this.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider("mjml-preview", this.provider),

            vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
                if (helper.isMJMLFile(document)) {
                    this.provider.update(this.previewUri);
                }
            }),

            vscode.workspace.onDidChangeTextDocument((event: vscode.TextDocumentChangeEvent) => {
                if (vscode.workspace.getConfiguration("mjml").updateWhenTyping) {
                    if (helper.isMJMLFile(event.document)) {
                        this.provider.update(this.previewUri);
                    }
                }
            }),

            vscode.window.onDidChangeActiveTextEditor((editor?: vscode.TextEditor) => {
                if (editor) {
                    if (this.document.uri === editor.document.uri) {
                        if (helper.isMJMLFile(editor.document)) {
                            this.provider.update(this.previewUri);
                        }
                    }
                }
            })
        );
    }

    public dispose(): void {
        for (let i = 0; i < this.subscriptions.length; i++) {
            this.subscriptions[i].dispose();
        }
    }

    public execute(): void {
        vscode.commands.executeCommand("vscode.previewHtml", this.previewUri, this.viewColumn, this.label).then((success: boolean) => {
            if (this.viewColumn === 2) {
                if (vscode.workspace.getConfiguration("mjml").preserveFocus) {
                    // Preserve focus of Text Editor after preview open
                    vscode.window.showTextDocument(this.document);
                }
            }
        }, (reason: string) => {
            vscode.window.showErrorMessage(reason);
        });
    }

    public get uri(): vscode.Uri {
        return this.previewUri;
    }

    private createUri(uri: vscode.Uri): vscode.Uri {
        return vscode.Uri.parse("mjml-preview://authority/mjml-preview/sidebyside/");
    }

}

class PreviewContentProvider implements vscode.TextDocumentContentProvider {

    private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
    private document: vscode.TextDocument;

    constructor(document: vscode.TextDocument, private env: nunjucks.Environment) {
        this.document = document;
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update(uri: vscode.Uri): void {
        if (/mjml-preview/.test(uri.fsPath) && /sidebyside/.test(uri.fsPath)) {
            const cache = (this.env as any).loaders[0].cache;
            if (cache[vscode.window.activeTextEditor.document.uri.fsPath] || vscode.window.activeTextEditor.document.fileName == this.document.fileName) {
                delete cache[vscode.window.activeTextEditor.document.uri.fsPath];
                this._onDidChange.fire(uri);
            }
        }
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        if (this.document.languageId !== "mjml") {
            return this.error("Active editor doesn't show a MJML document.");
        }

        return this.renderMJML();
    }

    private renderMJML(): string {
        let rendered;
        try {
            var tmpl: nunjucks.Template = new Template(
                this.document.getText(),
                this.env,
                this.document.uri.fsPath, true);
            rendered = tmpl.render();
            let html: string = helper.mjml2html(rendered, false, false, this.document.uri.fsPath);
            if (html) {
                return helper.fixLinks(html, this.document.uri.fsPath);
            }
        } catch (e) {
            return this.error(e, rendered);
        }

        return this.error("Active editor doesn't show a MJML document.");
    }

    private error(error: any, mjml?: string): string {
        if (typeof error === 'object') {
            if (error.length) {
                const messages = error.map(err => {
 /*                 const regex = /of (.*?) \(/ig;
                    const matches = regex.exec(err.formattedMessage);
                    const link = matches ? `<a style="color:white" href="${OpenDocumentLink.createCommandUri(matches[1], 'L' + err.line)}"><h3 style="margin-bottom: 1rem">Line ${err.line}</h3></a>` : '';
 */                 let codePart = '';
                    if (mjml) {
                        const offendingLine = mjml.split('\n')[err.line - 1];
                        codePart = mjml.split('\n').slice(err.line - 4, err.line + 2).map((line, index) => `
                            <div style="white-space: pre-wrap;${line === offendingLine ? 'background-color: #ff8787' : ''}">${escapeHtml(line)}</div>
                        `).join('');
                    }
                    return `<div style="margin-bottom: 1rem">
                        <h4>Error: ${err.formattedMessage}</h4>
                        <div style="font-family: monospace; margin-top: 0.5rem; color: #322; background-color: #EEE; padding: 1rem; border-radius: 4px">
                            ${codePart}
                        </div>
                    </div>`;
                });
                return `
                    <head>
                        <base href="${this.document.uri.with({ scheme: 'vscode-workspace-resource' }).toString(true)}">
                    </head>
                    <body style="background:#AD2222; padding: 20px; color: white">
                        <h1 style="margin-bottom: 0.5rem;">Errors rendering MJML</h1>
                        ${messages}
                    </body>
                `;
            }

            if (error.name) {
                return `
                    <body style="background:#AD2222; padding: 20px; color: white">
                        <h1 style="margin-bottom: 0.5rem;">Error</h1>
                        <p style="margin-bottom: 1rem">${error.name}</p>
                        <div style="font-family: monospace; white-space: pre-wrap; margin-top: 0.5rem; color: #322; background-color: #EEE; padding: 1rem; border-radius: 4px">${error.message}</div>
                    </body>
                `;
            }
            return `
                <body style="background:#AD2222; padding: 20px; color: white">
                    <h1 style="margin-bottom: 0.5rem;">Error</h1>
                    <p style="margin-bottom: 1rem">${error.message}</p>
                    <div style="font-family: monospace; white-space: pre-wrap; margin-top: 0.5rem; color: #322; background-color: #EEE; padding: 1rem; border-radius: 4px">${error.stack}</div>
                </body>
            `;
        }

        return `
            <body style="background:#AD2222; padding: 20px; color: white">
                <h1 style="margin-bottom: 0.5rem;">Error</h1>
                <p style="margin-bottom: 1rem">${error}</p>
            </body>
        `;
    }

}

class IDMap {

    private map: Map<[string, vscode.Uri], string> = new Map<[string, vscode.Uri], string>();

    public clear(): void {
        this.map.clear();
    }

    private UUIDv4(): string {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c: string) => {
            let r: number = Math.random() * 16 | 0, v: number = c == "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    public createDocumentUri(uri: vscode.Uri): string {
        return JSON.stringify({ uri: uri });
    }

    public getByUri(uri: string, remove?: boolean): any {
        let keys: IterableIterator<[string, vscode.Uri]> = this.map.keys();
        let key: IteratorResult<[string, vscode.Uri]> = keys.next();

        while (!key.done) {
            if (key.value.indexOf(uri) > -1) {
                if (remove) {
                    return key.value;
                }
                else {
                    return this.map.get(key.value);
                }
            }

            key = keys.next();
        }

        return undefined;
    }

    public hasUri(uri: string): boolean {
        return this.getByUri(uri) != undefined;
    }

    public add(documentUri: string, previewUri: vscode.Uri): string {
        let id: string = this.UUIDv4();
        this.map.set([documentUri, previewUri], id);

        return id;
    }

    public delete(uri: string, previewUri: vscode.Uri): string {
        let id: string = this.getByUri(uri);
        this.map.delete(this.getByUri(uri, true));

        return id;
    }

}
