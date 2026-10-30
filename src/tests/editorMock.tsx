/**
 * Stand-in for the Blockly editor in jsdom tests: records what the app asks
 * it to do and lets a test simulate the student editing blocks.
 */
import type { BlocklyEditorProps } from '../components/BlocklyEditor';

export const editor = {
  props: null as BlocklyEditorProps | null,
  loads: [] as string[],
  focused: [] as string[],
  reset() {
    this.props = null;
    this.loads = [];
    this.focused = [];
  },
};

let lastLoad: unknown = null;
let lastFocus: unknown = null;

export default function MockBlocklyEditor(props: BlocklyEditorProps) {
  editor.props = props;
  if (props.loadRequest && props.loadRequest !== lastLoad) {
    lastLoad = props.loadRequest;
    editor.loads.push(props.loadRequest.xml);
  }
  if (props.focusRequest && props.focusRequest !== lastFocus) {
    lastFocus = props.focusRequest;
    editor.focused.push(props.focusRequest.blockId);
  }
  return <div data-testid="block-editor" />;
}
