import { useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import type { ParseIssue } from '../parser/types';
import { Icon } from './Icon';

export interface ImportFailure {
  readonly fileName: string;
  readonly issues: readonly ParseIssue[];
}

interface Props {
  /** The block editor (or a fallback when it cannot load). */
  readonly editor: ReactNode;
  readonly fileName: string | null;
  readonly imported: boolean;
  readonly loading: boolean;
  readonly commandCount: number;
  readonly errors: readonly ParseIssue[];
  readonly warnings: readonly ParseIssue[];
  readonly importFailure: ImportFailure | null;
  readonly canDownload: boolean;
  readonly onFile: (file: File) => void;
  readonly onDownload: () => void;
  readonly onNew: () => void;
  readonly onExample: () => void;
  /** Jump to a block in the editor; null when the editor is not available. */
  readonly onShowBlock: ((blockId: string) => void) | null;
}

function IssueList({
  issues,
  tone,
  label,
  onShowBlock,
}: {
  issues: readonly ParseIssue[];
  tone: 'error' | 'warning';
  label: string;
  onShowBlock: Props['onShowBlock'];
}) {
  return (
    <ul className={`issues issues--${tone}`} aria-label={label}>
      {issues.map((issue, i) => (
        <li key={i} className="issues__item">
          <Icon name={tone === 'error' ? 'error' : 'alert'} className="issues__icon" />
          <span className="issues__text">
            {issue.message}
            {issue.blockId && !onShowBlock && (
              <span className="issues__id">
                {' '}
                Block ID <code>{issue.blockId}</code>
              </span>
            )}
          </span>
          {issue.blockId && onShowBlock && (
            <button type="button" className="link-button" onClick={() => onShowBlock(issue.blockId!)} title={`Block ID ${issue.blockId}`}>
              Show block
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ProgramPanel(props: Props) {
  const { editor, fileName, imported, loading, commandCount, errors, warnings, importFailure, canDownload } = props;
  const { onFile, onDownload, onNew, onExample, onShowBlock } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const ready = errors.length === 0 && commandCount > 0;
  const steps = `${commandCount} ${commandCount === 1 ? 'command' : 'commands'}`;
  const status = loading
    ? 'Getting the editor ready…'
    : errors.length > 0
      ? `${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix before flying`
      : imported
        ? `Program imported — ${steps}`
        : ready
          ? `Ready to fly — ${steps}`
          : 'Snap blocks together to build a program';

  return (
    <section className="card program-card" aria-labelledby="program-title">
      <header className="card__header">
        <div className="card__titles">
          <h2 id="program-title" className="card__title">
            Program
          </h2>
          <p className="card__subtitle">Snap blocks into one stack, then press Run.</p>
        </div>
        <div className="toolbar" role="group" aria-label="Program actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onNew}>
            <Icon name="plus" /> New
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExample}>
            <Icon name="sparkle" /> Example
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => inputRef.current?.click()}>
            <Icon name="upload" /> Import
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onDownload} disabled={!canDownload}>
            <Icon name="download" /> Download
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            className="visually-hidden"
            aria-label="Import a Robolink Blockly .xml file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              // Allow re-selecting the same file after editing it.
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <div
        className={`editor-frame${dragging ? ' editor-frame--drop' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {editor}
        {dragging && (
          <div className="editor-frame__drop" aria-hidden="true">
            <Icon name="file" size={28} />
            <span>Drop your Robolink .xml file to open it</span>
          </div>
        )}
      </div>

      <footer className="program-status">
        {importFailure && (
          <div className="notice notice--error" role="group" aria-label="Import failed">
            <p className="notice__title">
              <Icon name="error" /> Could not import this program: <strong>{importFailure.fileName}</strong>
            </p>
            <IssueList issues={importFailure.issues} tone="error" label="Import errors" onShowBlock={null} />
          </div>
        )}
        <p className={`status-line status-line--${loading ? 'idle' : ready ? 'ok' : errors.length > 0 ? 'error' : 'idle'}`} role="status">
          <Icon name={ready ? 'check' : errors.length > 0 ? 'alert' : 'info'} />
          <span>{status}</span>
          {fileName && (
            <span className="chip" title="Last imported file">
              <Icon name="file" size={12} /> {fileName}
            </span>
          )}
        </p>
        {errors.length > 0 && <IssueList issues={errors} tone="error" label="Program problems" onShowBlock={onShowBlock} />}
        {warnings.length > 0 && (
          <div className="notice notice--warning">
            <p className="notice__title">Heads up: this program will probably fail.</p>
            <IssueList issues={warnings} tone="warning" label="Program warnings" onShowBlock={onShowBlock} />
          </div>
        )}
      </footer>
    </section>
  );
}
