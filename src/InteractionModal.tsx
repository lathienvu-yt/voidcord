import React, { useMemo, useState } from "react";

type Props = { modal: any; onClose: () => void; onSubmit: (components: any[]) => Promise<void> };

function ModalComponent({ component, values, setValues }: {
  component: any; values: Record<string, string>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const type = Number(component?.type);
  if (type === 10) return <div className="interaction-modal-text">{String(component.content || "")}</div>;
  if (type === 18) {
    const input = component.component;
    if (Number(input?.type) !== 4) return <div className="interaction-modal-unsupported">Unsupported field ({input?.type ?? "unknown"})</div>;
    const id = String(input.custom_id || "");
    return <label className="interaction-modal-field">
      <span className="interaction-modal-label">{component.label || "Input"}{input.required ? <em> *</em> : null}</span>
      {component.description && <small>{component.description}</small>}
      <textarea value={values[id] ?? ""} placeholder={input.placeholder || ""} required={input.required === true}
        minLength={typeof input.min_length === "number" ? input.min_length : undefined}
        maxLength={typeof input.max_length === "number" ? input.max_length : undefined}
        onChange={event => setValues(previous => ({ ...previous, [id]: event.target.value }))} />
      {typeof input.max_length === "number" && <small className="interaction-modal-counter">{(values[id] || "").length}/{input.max_length}</small>}
    </label>;
  }
  if (type === 1) return <div className="interaction-modal-row">{(component.components || []).map((child: any, index: number) =>
    <ModalComponent key={child.id ?? index} component={child} values={values} setValues={setValues} />)}</div>;
  return <div className="interaction-modal-unsupported">Unsupported modal component type {type || "unknown"}</div>;
}

export default function InteractionModal({ modal, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const components = useMemo(() => Array.isArray(modal?.components) ? modal.components : [], [modal]);
  const collect = (component: any): any[] => {
    const type = Number(component?.type);
    if (type === 18 && Number(component.component?.type) === 4) {
      const input = component.component;
      return [{ ...component, component: { ...input, value: values[String(input.custom_id || "")] || "" } }];
    }
    if (type === 1) return [{ ...component, components: (component.components || []).flatMap(collect) }];
    return [component];
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSubmit(components.flatMap(collect)); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="interaction-modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <form className="interaction-modal" role="dialog" aria-modal="true" aria-labelledby="interaction-modal-title" onSubmit={submit}>
      <button type="button" className="interaction-modal-close" aria-label="Close modal" disabled={busy} onClick={onClose}>×</button>
      <h2 id="interaction-modal-title">{modal?.title || "Interaction"}</h2>
      <div className="interaction-modal-body">{components.map((component: any, index: number) =>
        <ModalComponent key={component.id ?? index} component={component} values={values} setValues={setValues} />)}</div>
      {error && <div className="interaction-modal-error">{error}</div>}
      <div className="interaction-modal-actions">
        <button type="button" className="interaction-modal-cancel" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="interaction-modal-submit" disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
      </div>
    </form>
  </div>;
}
