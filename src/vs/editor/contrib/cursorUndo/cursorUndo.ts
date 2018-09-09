/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

// カーソル位置のUndoができるようになる拡張

import * as nls from 'vs/nls';
import { Selection } from 'vs/editor/common/core/selection';
import { ServicesAccessor, registerEditorContribution, EditorAction, registerEditorAction } from 'vs/editor/browser/editorExtensions';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorContribution, ScrollType } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

// カーソルの位置を保持するクラス

class CursorState {
	readonly selections: Selection[];

	constructor(selections: Selection[]) {
		this.selections = selections;
	}

	public equals(other: CursorState): boolean {
		const thisLen = this.selections.length;
		const otherLen = other.selections.length;
		if (thisLen !== otherLen) {
			return false;
		}
		for (let i = 0; i < thisLen; i++) {
			if (!this.selections[i].equalsSelection(other.selections[i])) {
				return false;
			}
		}
		return true;
	}
}

// このクラスのインスタンスはエディターごとに作られる

export class CursorUndoController extends Disposable
	implements IEditorContribution {
	private static readonly ID = 'editor.contrib.cursorUndoController';

	public static get(editor: ICodeEditor): CursorUndoController {
		return editor.getContribution<CursorUndoController>(
			CursorUndoController.ID
		);
	}

	private readonly _editor: ICodeEditor;
	// カーソルを元に戻した時に、
	// カーソル移動が記憶されないようにするために使うフラグ
	private _isCursorUndo: boolean;

	private _undoStack: CursorState[];
	private _prevState: CursorState;

	constructor(editor: ICodeEditor) {
		super();
		this._editor = editor;
		this._isCursorUndo = false;

		this._undoStack = [];
		this._prevState = this._readState();

		this._register(
			editor.onDidChangeModel(e => {
				// Editor modelが変更した時には
				// 状態を空にする
				this._undoStack = [];
				this._prevState = null;
			})
		);
		this._register(
			editor.onDidChangeModelContent(e => {
				// Editor modelの内容が変更した時には
				// 状態を空にする
				this._undoStack = [];
				this._prevState = null;
			})
		);
		this._register(
			editor.onDidChangeCursorSelection(e => {
				// カーソル位置が変わった時に、カーソル位置を
				// スタックに貯める
				if (!this._isCursorUndo && this._prevState) {
					this._undoStack.push(this._prevState);
					// カーソル位置の記憶が50件に達したら
					// 古いものを消す
					if (this._undoStack.length > 50) {
						// keep the cursor undo stack bounded
						this._undoStack.shift();
					}
				}

				// 現在のカーソル位置を、次にカーソルが
				// 動いた時用に保存しておく
				this._prevState = this._readState();
			})
		);
	}

	private _readState(): CursorState {
		if (!this._editor.getModel()) {
			// no model => no state
			return null;
		}

		return new CursorState(this._editor.getSelections());
	}

	public getId(): string {
		return CursorUndoController.ID;
	}

	public cursorUndo(): void {
		const currState = new CursorState(this._editor.getSelections());

		while (this._undoStack.length > 0) {
			const prevState = this._undoStack.pop();

			if (!prevState.equals(currState)) {
				this._isCursorUndo = true;
				this._editor.setSelections(prevState.selections);
				this._editor.revealRangeInCenterIfOutsideViewport(
					prevState.selections[0],
					ScrollType.Smooth
				);
				this._isCursorUndo = false;
				return;
			}
		}
	}
}

export class CursorUndo extends EditorAction {
	constructor() {
		super({
			id: 'cursorUndo',
			label: nls.localize("cursor.undo", "Soft Undo"),
			alias: 'Soft Undo',
			precondition: null,
			kbOpts: {
				// テキスト入力状態にある
				kbExpr: EditorContextKeys.textInputFocus,
				// Ctrl(Cmd) + U で発火
				primary: KeyMod.CtrlCmd | KeyCode.KEY_U,

				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(
		accessor: ServicesAccessor,
		editor: ICodeEditor,
		args: any
	): void {
		// アクションが発火されたエディターの
		// CursorUndoControllerのインスタンスを取得し、
		// カーソルを一つ前の位置に戻す動作を実行
		CursorUndoController.get(editor).cursorUndo();
	}
}

// エディターの拡張を登録
registerEditorContribution(CursorUndoController);
// エディターのアクションを登録
registerEditorAction(CursorUndo);
