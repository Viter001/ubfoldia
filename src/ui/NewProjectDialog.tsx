import { useState } from 'react';
import type { NewProjectInput } from './api';

/** Modal that validates page size before asking the desktop shell for a folder. */
export function NewProjectDialog({
  error,
  onClose,
  onCreate,
}: {
  error: string;
  onClose: () => void;
  onCreate: (input: NewProjectInput) => Promise<boolean>;
}) {
  const [name, setName] = useState('我的互动绘本');
  const [size, setSize] = useState('1280x720');
  const [dims, setDims] = useState({ width: '1280', height: '720' });
  const [validation, setValidation] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const width = Number(dims.width),
      height = Number(dims.height);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 200 ||
      width > 4096 ||
      height < 200 ||
      height > 4096
    ) {
      setValidation('宽度和高度需为 200–4096 之间的整数。');
      return;
    }
    setValidation('');
    if (await onCreate({ name, width, height })) onClose();
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <span className="eyebrow">新的创作</span>
        <h2>给故事一个起点</h2>
        <label className="field">
          <span>工程名称</span>
          <input
            autoFocus
            required
            maxLength={300}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>页面尺寸</span>
          <select
            value={size}
            onChange={(event) => {
              const value = event.target.value;
              setSize(value);
              setValidation('');
              if (value !== 'custom') {
                const [width, height] = value.split('x').map(Number);
                setDims({ width: String(width), height: String(height) });
              }
            }}
          >
            <option value="1280x720">横向 · 1280 × 720</option>
            <option value="720x1280">纵向 · 720 × 1280</option>
            <option value="1024x1024">方形 · 1024 × 1024</option>
            <option value="custom">自定义尺寸</option>
          </select>
        </label>
        <div className="field-grid">
          <label className="field">
            <span>宽度（200–4096）</span>
            <input
              type="number"
              min={200}
              max={4096}
              step={1}
              inputMode="numeric"
              value={dims.width}
              onChange={(event) => {
                setDims((current) => ({ ...current, width: event.target.value }));
                setSize('custom');
              }}
            />
          </label>
          <label className="field">
            <span>高度（200–4096）</span>
            <input
              type="number"
              min={200}
              max={4096}
              step={1}
              inputMode="numeric"
              value={dims.height}
              onChange={(event) => {
                setDims((current) => ({ ...current, height: event.target.value }));
                setSize('custom');
              }}
            />
          </label>
        </div>
        {(validation || error) && (
          <p className="form-error" role="alert">
            {validation || error}
          </p>
        )}
        <p className="help">下一步选择工程文件夹。页面共用此尺寸，创建后不再更改。</p>
        <div className="row end">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit">
            选择位置并创建
          </button>
        </div>
      </form>
    </div>
  );
}
