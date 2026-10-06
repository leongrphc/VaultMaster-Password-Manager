'use client';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { contactFingerprint } from '@vaultmaster/crypto';
import type { ContactCard } from '@vaultmaster/crypto';
import type { ExchangeRecord } from '@vaultmaster/shared';
import { enrollExchangeDevice, getExchangeCard, rotateExchangeDevice, createExchange, listExchanges, exchangeAction, reviewExchange } from '@/lib/key-exchange';
import ImportReviewPanel from './ImportReviewPanel';
import type { ImportReview } from '@/lib/import-conflicts';
export default function KeyExchangePanel() {
  const items = useStore(s => s.items), key = useStore(s => s.masterKeyBase64);
  const [card, setCard] = useState<ContactCard | null>(null), [fingerprint, setFingerprint] = useState('');
  const [contact, setContact] = useState(''), [verified, setVerified] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<'share' | 'emergency'>('share'), [days, setDays] = useState(7), [waitHours, setWaitHours] = useState(24);
  const [records, setRecords] = useState<ExchangeRecord[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [review, setReview] = useState<ImportReview | null>(null);
  const reviewGuard = useRef<(() => void) | null>(null), active = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setCard(null); setContact(''); setVerified(false); setReview(null); setSelected([]); setRecords([]); reviewGuard.current = null; }, [key]);
  async function refresh() { const values = await listExchanges(); if (mounted.current) setRecords(values); }
  async function run(operation: () => Promise<void>) {
    if (active.current) return;
    active.current = true; setBusy(true); setMessage('');
    const guard = useStore.getState().getVaultOperationGuard();
    try { guard(); await operation(); guard(); await refresh(); guard(); if (mounted.current) setMessage('İşlem tamamlandı.'); }
    catch { if (mounted.current) setMessage('İşlem tamamlanamadı. Kasayı ve kişi kartını kontrol edip yenileyin.'); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  async function showCard(value: ContactCard) { const hash = await contactFingerprint(value); if (mounted.current) { setCard(value); setFingerprint(hash); } }
  const button = 'rounded-xl bg-accent/10 px-4 py-2 text-accent disabled:opacity-50';
  return <div className="space-y-5 rounded-2xl border border-border p-6" aria-label="Güvenli paylaşım">
    <h2>Paylaşım ve Acil Durum Erişimi</h2>
    <p className="text-sm">Kişi kartlarını güvenilir bir kanalda karşılaştırın. E-posta ile kişi araması yapılmaz. Her davet bir cihaz oturumuna bağlıdır. Alınan kopyalar geri silinemez.</p>
    <p className="text-sm">Acil durum erişimi çevrimiçi kasa sahibi onayı gerektirir; bekleme süresi otomatik kurtarma sağlamaz. Kişisel yedekler davetleri ve cihaz kişi kartlarını içermez.</p>
    <div className="flex gap-3"><button className={button} disabled={busy} onClick={() => void run(async () => showCard(await enrollExchangeDevice()))}>Cihaz Kişi Kartı Oluştur</button>
      <button className={button} disabled={busy} onClick={() => void run(async () => showCard(await getExchangeCard()))}>Kişi Kartımı Göster</button>
      <button className={button} disabled={busy} onClick={() => { if (window.confirm('Bu cihazın tüm davetleri iptal edilecek. Anahtarı silmek istiyor musunuz?')) void run(async () => { await rotateExchangeDevice(); setCard(null); setFingerprint(''); }); }}>Cihaz Anahtarını İptal Et</button></div>
    {card && <><textarea aria-label="Kişi kartım" readOnly value={JSON.stringify(card)} className="w-full bg-surface p-3" /><p className="break-all text-xs">Kişi kartı parmak izi: {fingerprint}</p></>}
    <textarea aria-label="Doğrulanmış kişi kartı" value={contact} onChange={event => { setContact(event.target.value); setVerified(false); }} placeholder="Güvenilir kanaldan aldığınız kişi kartını yapıştırın" className="w-full bg-surface p-3" />
    <label className="block"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} /> Kişi kartını bağımsız güvenilir kanalda karşılaştırdım.</label>
    <select aria-label="Erişim türü" value={kind} onChange={event => setKind(event.target.value as typeof kind)} className="bg-surface p-3"><option value="share">Seçili öğeleri paylaş</option><option value="emergency">Acil durum daveti</option></select>
    <label> Geçerlilik (gün) <input aria-label="Geçerlilik günü" type="number" min={1} max={30} value={days} onChange={event => setDays(Number(event.target.value))} className="bg-surface p-2" /></label>
    {kind === 'emergency' ? <label>Bekleme (saat) <input aria-label="Bekleme saati" type="number" min={1} max={720} value={waitHours} onChange={event => setWaitHours(Number(event.target.value))} className="bg-surface p-2" /></label> : <div>{items.map(item => <label className="block" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} /> {item.data.title}</label>)}</div>}
    <p className="text-xs">Paylaşım seçili öğelerin tüm gizli alanlarını içerir; ekler ve geçmiş içermez. Acil durum onayı tüm kişisel kasa anlık görüntüsünü (geçmiş, çöp ve ekler dahil) paylaşır. En fazla 2 MB şifrelenmemiş zarf desteklenir.</p>
    <button className={button} disabled={busy || !verified || (kind === 'share' && !selected.length)} onClick={() => { if (window.confirm(kind === 'share' ? 'Seçili öğelerin tüm gizli alanlarını bu cihaza paylaşmayı onaylıyor musunuz?' : 'Bu cihazı acil durum kişisi olarak davet etmeyi onaylıyor musunuz?')) void run(async () => createExchange(contact, kind, days, waitHours, selected)); }}>Daveti Onayla ve Gönder</button>
    <button className={button} disabled={busy} onClick={() => void run(refresh)}>Davetleri Yenile</button>
    {records.map(record => {
      const owner = card?.id === record.senderCard.id;
      const action = (value: Parameters<typeof exchangeAction>[1]) => { if (window.confirm({ accept: 'Bu cihazdan gelen daveti kabul etmeyi onaylıyor musunuz?', request: 'Kasa sahibinden acil erişim istemeyi onaylıyor musunuz?', grant: 'Geçmiş, çöp ve ekler dahil tüm kişisel kasa görüntüsünü bu cihaza paylaşmayı onaylıyor musunuz?', reject: 'Acil erişim talebini reddetmeyi onaylıyor musunuz?', revoke: 'Bu davetin teslimatını iptal etmeyi onaylıyor musunuz? Önceden alınmış kopyalar silinmez.' }[value])) void run(async () => { await exchangeAction(record, value, contact); setReview(null); }); };
      return <div key={record.id} className="space-y-2 rounded-xl border border-border p-4"><p>{record.kind === 'share' ? 'Paylaşım' : 'Acil durum'} · {record.status} · {new Date(record.expiresAt).toLocaleString()}</p>
        <button className={button} disabled={busy} onClick={() => void run(async () => showCard(await getExchangeCard()))}>Cihazımı Doğrula</button>
        {!owner && record.status === 'pending' && <button className={button} disabled={busy || !verified || !card} onClick={() => action('accept')}>Daveti Kabul Et</button>}
        {!owner && record.kind === 'emergency' && record.status === 'accepted' && <button className={button} disabled={busy || !card} onClick={() => action('request')}>Acil Erişim Talep Et</button>}
        {owner && record.status === 'requested' && <><button className={button} disabled={busy || !verified} onClick={() => action('grant')}>Kasa Görüntüsünü Onayla ve Paylaş</button><button className={button} disabled={busy} onClick={() => action('reject')}>Talebi Reddet</button></>}
        {!owner && ((record.kind === 'share' && record.status === 'accepted') || record.status === 'granted') && <button className={button} disabled={busy || !verified || !card} onClick={() => void run(async () => { const guard = useStore.getState().getVaultOperationGuard(); const result = await reviewExchange(record, contact); guard(); reviewGuard.current = guard; setReview(result); })}>Şifreyi Çöz ve İçe Aktarmayı İncele</button>}
        <button className={button} disabled={busy || !card} onClick={() => action('revoke')}>Erişimi İptal Et</button>
      </div>;
    })}
    {review && <ImportReviewPanel review={review} busy={busy} cancel={() => { setReview(null); reviewGuard.current = null; }} commit={async body => { reviewGuard.current?.(); await useStore.getState().runWithValidAccessToken(token => api.backups.restore(body, token, reviewGuard.current!)); reviewGuard.current?.(); await useStore.getState().loadVault(); setReview(null); }} />}
    {message && <p role="status">{message}</p>}
  </div>;
}
