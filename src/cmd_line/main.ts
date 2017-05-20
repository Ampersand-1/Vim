"use strict";

import * as vscode from "vscode";
import * as parser from "./parser";
import {VimState, ModeHandler} from "../mode/modeHandler";
import { Position, PositionDiff } from './../common/motion/position';
import {attach, RPCValue} from 'promised-neovim-client';
import {spawn} from 'child_process';
import { TextEditor } from "../textEditor";
import { Configuration } from '../configuration/configuration';

async function run(vimState: VimState, command: string) {

  const proc = spawn('nvim', ['-u', 'NONE', '-N', '--embed'], {cwd: __dirname });
  const nvim = await attach(proc.stdin, proc.stdout);
  nvim.on('request', (method: string, args: RPCValue[], resp: RPCValue) => {
    console.log(method, args, resp);
      // handle msgpack-rpc request
  });

  nvim.on('notification', (method: string, args: RPCValue[]) => {
    console.log(method, args);
      // handle msgpack-rpc notification
  });
  const buf = await nvim.getCurrentBuf();
  await buf.setLines(0, -1, true, TextEditor.getText().split('\n'));

  await nvim.callFunction("setpos", [".", [0, vimState.cursorPosition.line + 1, vimState.cursorPosition.character, false]]);
  await nvim.callFunction("setpos", ["'>", [0, vimState.cursorPosition.line + 1, vimState.cursorPosition.character, false]]);
  await nvim.callFunction("setpos", ["'<", [0, vimState.cursorStartPosition.line + 1, vimState.cursorStartPosition.character, false]]);
  for (const mark of vimState.historyTracker.getMarks()){
    await nvim.callFunction("setpos", [`'${mark.name}`, [0, mark.position.line + 1, mark.position.character, false]]);
  }

  command = ":" + command + "\n";
  for (const key of command) {
    await nvim.input(key);
  }


  if ((await nvim.getMode()).blocking) {
    await nvim.input('<esc>');
  }

  await TextEditor.replace(
    new vscode.Range(0, 0, TextEditor.getLineCount() - 1,
    TextEditor.getLineMaxColumn(TextEditor.getLineCount() - 1)),
    (await buf.getLines(0, -1, false)).join('\n')
  );

  let [row, character]  = (await nvim.callFunction("getpos", ["."]) as Array<number>).slice(1, 3);
  vimState.editor.selection = new vscode.Selection(new Position(row-1, character), new Position(row-1, character));

  if (Configuration.expandtab) {
    await vscode.commands.executeCommand("editor.action.indentationToSpaces");
  }
  nvim.quit();
  proc.kill();
  return;

}

// Shows the vim command line.
export async function showCmdLine(initialText: string, modeHandler : ModeHandler): Promise<undefined> {
  if (!vscode.window.activeTextEditor) {
    console.log("No active document.");
    return;
  }


  const options : vscode.InputBoxOptions = {
    prompt: "Vim command line",
    value: initialText,
    ignoreFocusOut: true,
    valueSelection: [initialText.length, initialText.length]
  };

  try {
    const cmdString = await vscode.window.showInputBox(options);
    await runCmdLine(cmdString!, modeHandler);
    return;
  } catch (e) {
    modeHandler.setStatusBarText(e.toString());
    return;
  }
}

export async function runCmdLine(command : string, modeHandler : ModeHandler) : Promise<undefined> {
  if (!command || command.length === 0) {
    return;
  }

  try {
    var cmd = parser.parse(command);
    if (cmd.isEmpty) {
      return;
    }
    if (cmd.command.neovimCapable) {
      await run(modeHandler.vimState, command).then(() => {
        console.log("Substituted for neovim command");
      }).catch((err) => console.log(err));
    } else {
      await cmd.execute(modeHandler.vimState.editor, modeHandler);
    }
    return;
  } catch (e) {
    await run(modeHandler.vimState, command).then(() => {
      console.log("SUCCESS");
    }).catch((err) => console.log(err));
    return;
  }
}
