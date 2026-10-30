import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import { birdsTheme, registerRobolinkBlocks } from '../blocks/blocklySetup';
import { EXAMPLE_PROGRAM_XML, TOOLBOX } from '../blocks/robolinkBlocks';

/** Why the editor is reporting its XML. */
export type EditorChangeReason = 'init' | 'load' | 'edit';

export interface BlocklyEditorProps {
  /** Replace the workspace with this program (bump `nonce` to load it again). */
  readonly loadRequest: { readonly xml: string; readonly nonce: number } | null;
  /** Scroll to and select a block (e.g. one with a problem). */
  readonly focusRequest: { readonly blockId: string; readonly nonce: number } | null;
  /** Block currently being flown, highlighted while the simulation plays. */
  readonly activeBlockId: string | null;
  /** Block where the flight failed. */
  readonly failedBlockId: string | null;
  readonly failedMessage: string | null;
  readonly onChange: (xml: string, reason: EditorChangeReason) => void;
}

const STORAGE_KEY = 'birds.program.v1';
const EDIT_DEBOUNCE_MS = 150;

function savedProgram(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveProgram(xml: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, xml);
  } catch {
    // Private mode or blocked storage: the program just isn't remembered.
  }
}

function toXml(workspace: Blockly.Workspace): string {
  return Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
}

/** Loads a program without firing edit events, then frames it nicely. */
function load(workspace: Blockly.WorkspaceSvg, xml: string): boolean {
  Blockly.Events.disable();
  try {
    workspace.clear();
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), workspace);
    return true;
  } catch {
    workspace.clear();
    return false;
  } finally {
    Blockly.Events.enable();
    const first = workspace.getTopBlocks(true)[0];
    if (first) workspace.scrollBoundsIntoView(first.getBoundingRectangle());
  }
}

/** The Robolink-style block editor. Default export so it can be code-split. */
export default function BlocklyEditor(props: BlocklyEditorProps) {
  const { loadRequest, focusRequest, activeBlockId, failedBlockId, failedMessage, onChange } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    registerRobolinkBlocks();
    // On phones a side palette would leave no room to build: put it along the top instead.
    const narrow = host.clientWidth > 0 && host.clientWidth < 520;
    const workspace = Blockly.inject(host, {
      horizontalLayout: narrow,
      toolboxPosition: 'start',
      toolbox: TOOLBOX,
      theme: birdsTheme(),
      renderer: 'zelos',
      media: `${import.meta.env.BASE_URL}blockly-media/`,
      sounds: false,
      trashcan: true,
      // No grid snapping: it made dragged blocks jump in steps instead of gliding.
      grid: { spacing: 24, length: 2.5, colour: '#dfe3ea', snap: false },
      zoom: { controls: true, wheel: false, startScale: narrow ? 0.7 : 0.85, maxScale: 1.6, minScale: 0.45, scaleSpeed: 1.15, pinch: true },
      move: { scrollbars: true, drag: true, wheel: true },
    });
    workspaceRef.current = workspace;

    const initial = savedProgram();
    if (!(initial && load(workspace, initial))) load(workspace, EXAMPLE_PROGRAM_XML);
    const report = (reason: EditorChangeReason) => {
      const xml = toXml(workspace);
      saveProgram(xml);
      onChangeRef.current(xml, reason);
    };
    report('init');

    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Mid-drag, a block pulled from the drawer is briefly a loose stack of
        // its own: wait for the drop instead of flashing a "2 groups" error.
        if (workspace.isDragging()) return;
        report('edit');
      }, EDIT_DEBOUNCE_MS);
    };
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.type === Blockly.Events.BLOCK_DRAG) {
        if (!(event as Blockly.Events.BlockDrag).isStart) schedule();
        return;
      }
      if (event.isUiEvent) return;
      schedule();
    };
    workspace.addChangeListener(listener);

    const observer = new ResizeObserver(() => Blockly.svgResize(workspace));
    observer.observe(host);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      workspace.removeChangeListener(listener);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, []);

  // Programs imported from a file (or the example / new buttons).
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !loadRequest) return;
    load(workspace, loadRequest.xml);
    const xml = toXml(workspace);
    saveProgram(xml);
    onChangeRef.current(xml, 'load');
  }, [loadRequest]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !focusRequest) return;
    const block = workspace.getBlockById(focusRequest.blockId);
    if (!block) return;
    workspace.centerOnBlock(block.id);
    block.select();
  }, [focusRequest]);

  // Glow on the block being flown right now.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.highlightBlock(activeBlockId);
  }, [activeBlockId]);

  // Warning badge on the block where the flight failed.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !failedBlockId) return undefined;
    const block = workspace.getBlockById(failedBlockId);
    if (!block) return undefined;
    block.setWarningText(failedMessage ?? 'The flight stopped here.');
    workspace.highlightBlock(failedBlockId);
    return () => {
      if (!block.isDisposed()) block.setWarningText(null);
      workspace.highlightBlock(null);
    };
  }, [failedBlockId, failedMessage]);

  return <div ref={hostRef} className="blockly-host" data-testid="block-editor" />;
}
