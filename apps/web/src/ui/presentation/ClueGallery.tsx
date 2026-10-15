import { useEffect, useState } from 'react';
import { request } from '../../api';
import { presentationPath, type PresentationAsset } from './usePresentation';
import ImageViewport from './ImageViewport';

export default function ClueGallery({ roomId, revision }: { roomId: string; revision: number }) {
  const [assets, setAssets] = useState<PresentationAsset[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState('');
  async function reload() {
    try {
      setAssets(await request<PresentationAsset[]>(`${presentationPath(roomId)}/assets`));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void reload();
  }, [roomId, revision]);
  const chosen = assets.find((asset) => asset.id === selected);
  return (
    <div className="space-y-3">
      <div className="eyebrow">REVEALED CLUES</div>
      <h3 className="display-title text-xl">已公开线索</h3>
      <p className="tiny subtle">只有 GM 允许回看的剧情图片会出现在这里。</p>
      <button className="btn" onClick={() => void reload()}>
        刷新线索
      </button>
      {error && <p className="text-red-300 tiny">{error}</p>}
      <div className="presentation-asset-list">
        {assets.map((asset) => (
          <button
            key={asset.id}
            className={`presentation-asset ${selected === asset.id ? 'selected' : ''}`}
            onClick={() => setSelected(asset.id)}
          >
            <img src={asset.thumbUrl} alt="" />
            <span>{asset.title}</span>
          </button>
        ))}
      </div>
      {chosen ? (
        <div className="presentation-preview">
          <ImageViewport key={chosen.id} src={chosen.screenUrl} title={chosen.title} />
          <div className="p-3">
            <strong>{chosen.title}</strong>
            <p className="tiny mt-1 whitespace-pre-wrap">{chosen.caption}</p>
          </div>
        </div>
      ) : (
        <div className="empty-note">还没有可回看的剧情线索。</div>
      )}
    </div>
  );
}
