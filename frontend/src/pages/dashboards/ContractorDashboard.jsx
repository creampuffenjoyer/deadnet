import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import client from '../../api/client'
import Navbar from '../../components/ui/Navbar'
import Footer from '../../components/ui/Footer'
import Scanlines from '../../components/effects/Scanlines'
import Badge from '../../components/ui/Badge'
import { usePlatformFormat } from '../../hooks/usePlatformFormat'
import { useAuth } from '../../context/AuthContext'

const ALL_CATEGORIES = [
  'Web', 'Cryptography', 'Forensics', 'Pwn', 'Misc', 'OSINT',
  'Reverse Engineering', 'SQL Injection', 'Steganography', 'Network',
  'Mobile', 'Cloud', 'Blockchain', 'Hardware', 'Binary Exploitation', 'Social Engineering',
]
const CC_DURATIONS  = [15, 30, 45, 60]
const CC_BC_OPTIONS = [50, 100, 200, 300, 400, 500]
const CC_EMPTY = { title: '', description: '', flag: '', category: 'Web', duration_minutes: 30, bc_reward: 100 }

const CC_STATUS_COLOR = {
  DRAFT:   'text-ghost border-ghost/30',
  ACTIVE:  'text-success border-success/40',
  EXPIRED: 'text-danger border-danger/30',
  CLOSED:  'text-ghost/40 border-ghost/20',
}
const RARITIES = ['COMMON', 'RARE', 'CLASSIFIED']

const RARITY_COLOR = {
  COMMON: 'text-common-glow',
  RARE: 'text-rare-glow',
  CLASSIFIED: 'text-classified-glow',
}

const RARITY_CONFIG = {
  COMMON:     { border: '#8A8A9A', text: '#8A8A9A' },
  RARE:       { border: '#4A9EFF', text: '#4A9EFF' },
  EPIC:       { border: '#a855f7', text: '#a855f7' },
  CLASSIFIED: { border: '#FF2D2D', text: '#FF2D2D' },
  'VO1D':     { border: '#dc2626', text: '#dc2626', glow: true },
}

const LIST_COLS = 'grid grid-cols-[2fr_180px_130px_90px_90px_150px]'

const SORT_OPTIONS = [
  { value: 'rarity',  label: 'Rarity Tier' },
  { value: 'bc_high', label: 'BC — High to Low' },
  { value: 'bc_low',  label: 'BC — Low to High' },
  { value: 'newest',  label: 'Date — Newest' },
  { value: 'oldest',  label: 'Date — Oldest' },
  { value: 'title',   label: 'Title — A to Z' },
]

const RARITY_TIER = { COMMON: 0, RARE: 1, EPIC: 2, CLASSIFIED: 3, 'VO1D': 4 }
const PAGE_SIZE = 20

function applyFiltersAndSort(contracts, { filterCategory, filterStatus, sortBy }) {
  const result = contracts
    .filter(c => filterCategory === 'ALL' || c.category === filterCategory)
    .filter(c => {
      if (filterStatus === 'PUBLISHED') return c.is_published
      if (filterStatus === 'DRAFT') return !c.is_published
      return true
    })
  const copy = [...result]
  switch (sortBy) {
    case 'rarity':  copy.sort((a, b) => (RARITY_TIER[a.rarity] ?? 99) - (RARITY_TIER[b.rarity] ?? 99)); break
    case 'bc_high': copy.sort((a, b) => (b.base_bc_value || 0) - (a.base_bc_value || 0)); break
    case 'bc_low':  copy.sort((a, b) => (a.base_bc_value || 0) - (b.base_bc_value || 0)); break
    case 'newest':  copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); break
    case 'oldest':  copy.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); break
    case 'title':   copy.sort((a, b) => a.title.localeCompare(b.title)); break
    default: break
  }
  return copy
}

const EMPTY_FORM = {
  title: '',
  description: '',
  category: 'Web',
  rarity: 'COMMON',
  base_bc_value: 100,
  flag: '',
  is_published: false,
  intel_drops: [{ content: '', cost_bc: 30 }],
  max_attempts: 0,
}

// ---------------------------------------------------------------------------
// ContractFormModal
// ---------------------------------------------------------------------------
function ContractFormModal({ contract, onClose, onSaved, onFileUploaded, events = [] }) {
  const { allowed_file_types, max_upload_mb } = usePlatformFormat()
  const _exts = (allowed_file_types || 'zip,pdf,txt,png,jpg,bin,elf').split(',').map(e => e.trim().replace(/^\./, '')).filter(Boolean)
  const fileAccept = [
    ..._exts.map(e => `.${e}`),
    ...(_exts.some(e => ['bin','elf','exe','so','dll'].includes(e)) ? ['application/octet-stream','application/x-executable'] : []),
  ].join(',')

  const [form, setForm] = useState(contract
    ? {
        title: contract.title,
        description: contract.description,
        category: contract.category,
        rarity: contract.rarity,
        base_bc_value: contract.base_bc_value,
        flag: '',  // never pre-fill flag in edit mode
        is_published: contract.is_published,
        intel_drops: contract.intel_drops?.length
          ? contract.intel_drops
          : [{ content: '', cost_bc: 30 }],
        max_attempts: contract.max_attempts ?? 0,
      }
    : { ...EMPTY_FORM, intel_drops: [{ content: '', cost_bc: 30 }] }
  )
  // Event selector for create mode
  const [selectedEventId, setSelectedEventId] = useState(
    events.length > 0 ? String(events[0].id) : ''
  )
  const selectedEvent = events.find(e => String(e.id) === selectedEventId)
  const isMajorSelected = selectedEvent?.event_type === 'MAJOR'
  const availableCategories = selectedEvent?.allowed_categories?.length
    ? ALL_CATEGORIES.filter(c => selectedEvent.allowed_categories.includes(c))
    : ALL_CATEGORIES
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showFlag, setShowFlag] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [imageFile, setImageFile] = useState(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const fileRef = useRef()
  const imageRef = useRef()

  const isEdit = !!contract

  function setDrop(i, field, val) {
    setForm(f => {
      const drops = [...f.intel_drops]
      drops[i] = { ...drops[i], [field]: val }
      return { ...f, intel_drops: drops }
    })
  }

  function addDrop() {
    if (form.intel_drops.length >= 3) return
    setForm(f => ({ ...f, intel_drops: [...f.intel_drops, { content: '', cost_bc: 30 }] }))
  }

  function removeDrop(i) {
    setForm(f => ({ ...f, intel_drops: f.intel_drops.filter((_, idx) => idx !== i) }))
  }

  async function handleSave() {
    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }
    if (!isEdit && !form.flag.trim()) {
      setError('Flag is required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      let flagVariants = null
      const payload = {
        ...form,
        intel_drops: form.intel_drops.filter(d => d.content.trim()),
      }
      if (isEdit) {
        // Only send flag if user typed one (otherwise omit to leave unchanged)
        if (!form.flag.trim()) delete payload.flag
        const res = await client.put(`/contractor/contracts/${contract.id}`, payload)
        flagVariants = res.data?.flag_variants || null
      } else {
        if (selectedEventId) payload.event_id = parseInt(selectedEventId)
        const res = await client.post('/contractor/contracts', payload)
        const newId = res.data?.id
        flagVariants = res.data?.flag_variants || null
        // Upload staged file attachment
        if (uploadFile && newId) {
          const fd = new FormData()
          fd.append('file', uploadFile)
          await client.post(`/contracts/${newId}/attachments`, fd, { headers: { 'Content-Type': undefined } })
        }
        // Upload staged display image
        if (imageFile && newId) {
          const fd = new FormData()
          fd.append('file', imageFile)
          await client.post(`/contracts/${newId}/attachments`, fd, { headers: { 'Content-Type': undefined } })
        }
      }
      onSaved(flagVariants)
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  function showUploadSuccess(msg) {
    setUploadMsg(msg)
    setTimeout(() => setUploadMsg(''), 3000)
  }

  async function handleUpload() {
    if (!uploadFile || !contract?.id) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', uploadFile)
    try {
      await client.post(`/contracts/${contract.id}/attachments`, fd, { headers: { 'Content-Type': undefined } })
      setUploadFile(null)
      if (fileRef.current) fileRef.current.value = ''
      showUploadSuccess(`✓ ${uploadFile.name} uploaded successfully`)
      onFileUploaded?.()
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function handleImageUpload() {
    if (!imageFile || !contract?.id) return
    setImageUploading(true)
    const fd = new FormData()
    fd.append('file', imageFile)
    try {
      await client.post(`/contracts/${contract.id}/attachments`, fd, { headers: { 'Content-Type': undefined } })
      setImageFile(null)
      if (imageRef.current) imageRef.current.value = ''
      showUploadSuccess(`✓ ${imageFile.name} uploaded — operatives will see it inline`)
      onFileUploaded?.()
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Image upload failed.')
    } finally {
      setImageUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-void/90 overflow-y-auto py-8 px-4">
      <div className="w-full max-w-2xl border border-ghost/30 bg-abyss rounded-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ghost/20">
          <span className="font-mono text-xs text-ghost tracking-widest">
            {isEdit ? `EDITING — ${contract.title}` : 'NEW CONTRACT'}
          </span>
          <button onClick={onClose} className="font-mono text-ghost hover:text-ember text-xs">✕ CLOSE</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <p className="font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">{error}</p>
          )}
          {uploadMsg && (
            <p className="font-mono text-xs text-success border border-success/30 bg-success/10 rounded-sm px-3 py-2">{uploadMsg}</p>
          )}

          {/* Event selector — create mode only, when multiple events available */}
          {!isEdit && events.length > 1 && (
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">TARGET EVENT</label>
              <select
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={selectedEventId}
                onChange={e => setSelectedEventId(e.target.value)}
              >
                {events.map(e => (
                  <option key={e.id} value={String(e.id)}>
                    {e.name} {e.event_type === 'MAJOR' ? '[MAJOR]' : '[LOCAL]'} — {e.status} #{e.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* MAJOR event notice */}
          {!isEdit && isMajorSelected && (
            <div className="border border-flare/30 bg-flare/5 rounded-sm px-3 py-2">
              <p className="font-mono text-xs text-flare tracking-widest">MAJOR EVENT</p>
              <p className="font-mono text-[10px] text-bone/70 mt-1">
                Creating challenge for a MAJOR EVENT. Unique flag variants will be automatically
                generated per participating organization. Plain variants are shown once after creation.
              </p>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">TITLE</label>
            <input
              className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>

          {/* Category + Rarity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">CATEGORY</label>
              <select
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              >
                {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">RARITY</label>
              <select
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={form.rarity}
                onChange={e => setForm(f => ({ ...f, rarity: e.target.value }))}
              >
                {RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {/* BC Value */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">BASE BC VALUE</label>
              <input
                type="number"
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={form.base_bc_value}
                onChange={e => setForm(f => ({ ...f, base_bc_value: parseInt(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">
                MAX ATTEMPTS <span className="text-ghost/40 normal-case tracking-normal">(0 = unlimited)</span>
              </label>
              <input
                type="number"
                min="0"
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={form.max_attempts}
                onChange={e => setForm(f => ({ ...f, max_attempts: Math.max(0, parseInt(e.target.value) || 0) }))}
              />
            </div>
          </div>

          {/* Flag */}
          <div>
            <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">FLAG</label>
            {isEdit && contract.is_blocked_for_own_org ? (
              <div className="border border-ghost/20 rounded-sm px-3 py-2 bg-void/50">
                <span className="font-mono text-sm text-ghost/50 tracking-widest">••••••••</span>
                <p className="font-mono text-[10px] text-ghost/40 mt-1">
                  Flag hidden — use [ UPDATE FLAG ] in the contract list to regenerate org variants.
                </p>
              </div>
            ) : (
              <div className="relative">
                <input
                  type={showFlag ? 'text' : 'password'}
                  className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 pr-14 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                  placeholder={isEdit ? 'DEADNET{...} — leave blank to keep current' : 'DEADNET{...}'}
                  value={form.flag}
                  onChange={e => setForm(f => ({ ...f, flag: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowFlag(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ghost hover:text-bone tracking-widest"
                >
                  {showFlag ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">DESCRIPTION (MARKDOWN)</label>
            <textarea
              rows={6}
              className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember resize-y"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* Intel Drops */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-mono text-[10px] text-ghost tracking-widest">INTEL DROPS ({form.intel_drops.length}/3)</label>
              {form.intel_drops.length < 3 && (
                <button onClick={addDrop} className="font-mono text-[10px] text-ember hover:text-flare tracking-widest">+ ADD DROP</button>
              )}
            </div>
            <div className="space-y-2">
              {form.intel_drops.map((drop, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="flex-1 bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember"
                    placeholder={`Intel hint ${i + 1}`}
                    value={drop.content}
                    onChange={e => setDrop(i, 'content', e.target.value)}
                  />
                  <input
                    type="number"
                    className="w-20 bg-void border border-ghost/20 rounded-sm px-2 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember"
                    placeholder="BC"
                    value={drop.cost_bc}
                    onChange={e => setDrop(i, 'cost_bc', parseInt(e.target.value) || 0)}
                  />
                  {form.intel_drops.length > 1 && (
                    <button onClick={() => removeDrop(i)} className="font-mono text-xs text-ghost hover:text-danger px-1">✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Published toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setForm(f => ({ ...f, is_published: !f.is_published }))}
              className={`w-10 h-5 rounded-full transition-colors relative ${form.is_published ? 'bg-ember' : 'bg-ghost/30'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-bone rounded-full transition-transform ${form.is_published ? 'translate-x-5' : ''}`} />
            </button>
            <span className="font-mono text-xs text-ghost tracking-widest">
              {form.is_published ? 'PUBLISHED' : 'DRAFT'}
            </span>
          </div>

          {/* Contract image */}
          <div className="border-t border-ghost/10 pt-4">
            <label className="font-mono text-[10px] text-ghost tracking-widest block mb-2">
              CONTRACT IMAGE {!isEdit && <span className="text-ghost/40 ml-1">(displayed inline for operatives)</span>}
            </label>
            {/* Preview existing image attachments in edit mode */}
            {isEdit && contract.attachments?.filter(a => /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(a.original || '')).map((att, i) => (
              <div key={i} className="mb-2 font-mono text-xs text-bone/60 border border-ghost/20 rounded-sm px-2 py-0.5 w-fit">
                🖼 {att.original}
              </div>
            ))}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={imageRef}
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.svg,.webp,.bmp"
                onChange={e => setImageFile(e.target.files[0])}
                className="font-mono text-xs text-ghost file:mr-2 file:font-mono file:text-xs file:text-ghost file:border file:border-ghost/20 file:bg-void file:rounded-sm file:px-2 file:py-0.5 file:cursor-pointer"
              />
              {isEdit && imageFile && (
                <button
                  onClick={handleImageUpload}
                  disabled={imageUploading}
                  className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1 rounded-sm tracking-widest transition-all disabled:opacity-50"
                >
                  {imageUploading ? 'UPLOADING...' : 'UPLOAD IMAGE'}
                </button>
              )}
              {!isEdit && imageFile && (
                <span className="font-mono text-[10px] text-ghost/50 tracking-widest">will display on create</span>
              )}
            </div>
          </div>

          {/* File attachment */}
          <div className="border-t border-ghost/10 pt-4">
            <label className="font-mono text-[10px] text-ghost tracking-widest block mb-2">
              ATTACH FILE {!isEdit && <span className="text-ghost/40 ml-1">(uploaded on create)</span>}
            </label>
            {/* Show existing attachments in edit mode */}
            {isEdit && contract.attachments?.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {contract.attachments.map((att, i) => (
                  <span key={i} className="font-mono text-xs text-bone/60 border border-ghost/20 rounded-sm px-2 py-0.5">
                    📎 {att.original || att.original_filename || att}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept={fileAccept}
                onChange={e => setUploadFile(e.target.files[0])}
                className="font-mono text-xs text-ghost file:mr-2 file:font-mono file:text-xs file:text-ghost file:border file:border-ghost/20 file:bg-void file:rounded-sm file:px-2 file:py-0.5 file:cursor-pointer"
              />
              {/* In edit mode show a standalone upload button; create bundles it into CREATE */}
              {isEdit && uploadFile && (
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1 rounded-sm tracking-widest transition-all disabled:opacity-50"
                >
                  {uploading ? 'UPLOADING...' : 'UPLOAD'}
                </button>
              )}
              {!isEdit && uploadFile && (
                <span className="font-mono text-[10px] text-ghost/50 tracking-widest">will upload on create</span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-ghost/20">
          <button
            onClick={onClose}
            className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-2 rounded-sm tracking-widest transition-all"
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
          >
            {saving ? 'SAVING...' : isEdit ? 'SAVE CHANGES' : 'CREATE CONTRACT'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FlagVariantsModal — shown once after MAJOR event contract create/update
// ---------------------------------------------------------------------------
function FlagVariantsModal({ variants, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/95 px-4">
      <div className="w-full max-w-2xl border border-flare/40 bg-abyss rounded-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ghost/20">
          <div>
            <span className="font-mono text-xs text-flare tracking-widest">MAJOR EVENT — FLAG VARIANTS</span>
            <p className="font-mono text-[10px] text-ghost mt-0.5">
              These plain-text variants are shown ONCE. Save them now — they cannot be retrieved later.
            </p>
          </div>
          <button onClick={onClose} className="font-mono text-ghost hover:text-ember text-xs">✕</button>
        </div>
        <div className="px-6 py-4 overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-left min-w-[500px]">
            <thead>
              <tr className="border-b border-ghost/20">
                <th className="font-mono text-[10px] text-ghost tracking-widest pb-2 pr-4">ORG CODE</th>
                <th className="font-mono text-[10px] text-ghost tracking-widest pb-2 pr-4">ORG NAME</th>
                <th className="font-mono text-[10px] text-ghost tracking-widest pb-2">FLAG (PLAIN TEXT)</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={i} className="border-b border-ghost/10 hover:bg-void/40">
                  <td className="font-mono text-xs text-ember py-2 pr-4">{v.org_code}</td>
                  <td className="font-mono text-xs text-bone/70 py-2 pr-4">{v.org_name}</td>
                  <td className="font-mono text-xs text-success py-2 select-all">{v.flag}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t border-ghost/20 flex justify-end">
          <button
            onClick={onClose}
            className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all"
          >
            I HAVE SAVED THESE FLAGS
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UpdateFlagModal — for regenerating org variants on MAJOR event contracts
// ---------------------------------------------------------------------------
function UpdateFlagModal({ contractId, contractTitle, onClose, onUpdated }) {
  const [flag, setFlag] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!flag.trim()) { setError('Flag is required.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await client.put(`/contractor/contracts/${contractId}`, { flag: flag.trim() })
      const variants = res.data?.flag_variants || null
      onUpdated(variants)
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Update failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/95 px-4">
      <div className="w-full max-w-md border border-ghost/30 bg-abyss rounded-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ghost/20">
          <span className="font-mono text-xs text-ghost tracking-widest">UPDATE FLAG — {contractTitle}</span>
          <button onClick={onClose} className="font-mono text-ghost hover:text-ember text-xs">✕</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          {error && (
            <p className="font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">{error}</p>
          )}
          <div className="border border-flare/20 bg-flare/5 rounded-sm px-3 py-2">
            <p className="font-mono text-[10px] text-flare/80">
              Entering a new base flag will regenerate ALL org-specific variants. Old variants are immediately invalidated.
            </p>
          </div>
          <div>
            <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">NEW BASE FLAG</label>
            <input
              className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
              placeholder="DEADNET{...}"
              value={flag}
              onChange={e => setFlag(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-ghost/20">
          <button onClick={onClose} className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-2 rounded-sm tracking-widest">CANCEL</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest disabled:opacity-50"
          >
            {saving ? 'UPDATING...' : 'UPDATE & REGENERATE'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CCTab — Emergency Contracts management
// ---------------------------------------------------------------------------
function fmt_size(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function CCTab() {
  const { allowed_file_types, max_upload_mb } = usePlatformFormat()
  const _exts = (allowed_file_types || 'zip,pdf,txt,png,jpg,bin,elf').split(',').map(e => e.trim().replace(/^\./, '')).filter(Boolean)
  const fileAccept = [
    ..._exts.map(e => `.${e}`),
    ...(_exts.some(e => ['bin','elf','exe','so','dll'].includes(e)) ? ['application/octet-stream','application/x-executable'] : []),
  ].join(',')

  const [ccList, setCcList] = useState([])
  const [form, setForm] = useState({ ...CC_EMPTY })
  const [stagedFile, setStagedFile] = useState(null)
  const fileInputRef = useRef()
  const [creating, setCreating] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  async function loadCC() {
    try {
      const res = await client.get('/corrupted-contracts')
      setCcList(res.data)
    } catch { /* contractor might get empty */ }
  }

  useEffect(() => { loadCC() }, [])

  function flash(msg) {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(''), 3000)
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.flag.trim()) {
      setActionError('Title and flag are required.')
      return
    }
    setCreating(true)
    setActionError('')
    try {
      const res = await client.post('/corrupted-contracts', form)
      const newId = res.data?.id
      if (stagedFile && newId) {
        const fd = new FormData()
        fd.append('file', stagedFile)
        await client.post(`/corrupted-contracts/${newId}/upload`, fd, { headers: { 'Content-Type': undefined } })
      }
      setForm({ ...CC_EMPTY })
      setStagedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setFormOpen(false)
      flash('CC staged successfully.')
      await loadCC()
    } catch (e) {
      const detail = e.response?.data?.detail
      setActionError(typeof detail === 'string' ? detail : 'Create failed.')
    } finally {
      setCreating(false)
    }
  }

  async function handleActivate(id) {
    setActionError('')
    try {
      await client.post(`/corrupted-contracts/${id}/activate`)
      flash('CC is now ACTIVE.')
      await loadCC()
    } catch (e) {
      const detail = e.response?.data?.detail
      setActionError(typeof detail === 'string' ? detail : 'Activate failed.')
    }
  }

  async function handleClose(id) {
    setActionError('')
    try {
      await client.post(`/corrupted-contracts/${id}/close`)
      flash('CC closed.')
      await loadCC()
    } catch (e) {
      const detail = e.response?.data?.detail
      setActionError(typeof detail === 'string' ? detail : 'Close failed.')
    }
  }

  const active  = ccList.find(c => c.status === 'ACTIVE')
  const staged  = ccList.filter(c => c.status === 'DRAFT')
  const history = ccList.filter(c => c.status === 'EXPIRED' || c.status === 'CLOSED')

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">
          {actionError}
          <button className="ml-3 underline" onClick={() => setActionError('')}>dismiss</button>
        </div>
      )}
      {actionMsg && (
        <div className="font-mono text-xs text-success border border-success/30 bg-success/10 rounded-sm px-3 py-2">
          {actionMsg}
        </div>
      )}

      {/* Active CC */}
      <div className="border border-ghost/20 rounded-sm">
        <div className="px-4 py-2 border-b border-ghost/10 bg-abyss flex items-center gap-2">
          <span className="font-mono text-xs text-ghost tracking-widest">ACTIVE SIGNAL</span>
          {active && <span className="w-2 h-2 rounded-full bg-success animate-pulse" />}
        </div>
        {active ? (
          <div className="px-4 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="font-mono text-sm text-success font-bold tracking-widest">{active.title}</p>
                <p className="font-mono text-xs text-ghost mt-1">{active.category} · {active.duration_minutes}min · {active.claim_count} claimed · {active.bc_distributed} BC distributed</p>
                {active.expires_at && (
                  <p className="font-mono text-[10px] text-ghost/50 mt-0.5">
                    EXPIRES: {new Date(active.expires_at).toLocaleTimeString()}
                  </p>
                )}
                {active.has_attachment && (
                  <p className="font-mono text-[10px] text-ghost/50 mt-0.5">
                    ATTACHED FILE: {active.attachment_filename} ({fmt_size(active.attachment_size)})
                  </p>
                )}
              </div>
              <button
                onClick={() => handleClose(active.id)}
                className="font-mono text-xs text-danger border border-danger/30 hover:border-danger hover:bg-danger/10 px-3 py-1.5 rounded-sm tracking-widest transition-all"
              >
                FORCE CLOSE
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <p className="font-mono text-xs text-ghost/40 tracking-widest">NO ACTIVE EMERGENCY CONTRACT</p>
          </div>
        )}
      </div>

      {/* Deploy new EC */}
      <div className="border border-ghost/20 rounded-sm">
        <button
          onClick={() => setFormOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-abyss hover:bg-abyss/60 transition-colors"
        >
          <span className="font-mono text-xs text-ghost tracking-widest">DEPLOY NEW EC</span>
          <span className="font-mono text-xs text-ghost">{formOpen ? '▲' : '▼'}</span>
        </button>
        {formOpen && (
          <div className="px-4 pb-4 pt-2 space-y-3">
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">TITLE</label>
              <input
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">CATEGORY</label>
                <select
                  className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                >
                  {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">DURATION</label>
                <select
                  className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                  value={form.duration_minutes}
                  onChange={e => setForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) }))}
                >
                  {CC_DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">BC REWARD</label>
                <input
                  type="number"
                  min="1"
                  className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                  placeholder="e.g. 250"
                  value={form.bc_reward}
                  onChange={e => setForm(f => ({ ...f, bc_reward: parseInt(e.target.value) || 0 }))}
                />
                <p className="font-mono text-[9px] text-ghost/40 mt-1 tracking-wide">Hidden from operatives until claimed</p>
              </div>
              <div>
                <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">FLAG</label>
                <input
                  className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                  placeholder="DEADNET{...}"
                  value={form.flag}
                  onChange={e => setForm(f => ({ ...f, flag: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-1">DESCRIPTION</label>
              <textarea
                rows={3}
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember resize-y"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            {/* File attachment */}
            <div>
              <label className="font-mono text-[10px] text-ghost tracking-widest block mb-2">ATTACHMENT (optional)</label>
              {stagedFile ? (
                <div className="flex items-center gap-3 font-mono text-xs border border-ghost/20 rounded-sm px-3 py-2 bg-void">
                  <span className="text-success">&#10003;</span>
                  <span className="text-bone flex-1">{stagedFile.name} ({(stagedFile.size / (1024*1024)).toFixed(1)} MB)</span>
                  <button
                    onClick={() => { setStagedFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="text-ghost hover:text-danger"
                  >
                    REMOVE
                  </button>
                </div>
              ) : (
                <label
                  className="flex flex-col items-center justify-center w-full py-4 rounded-sm cursor-pointer transition-colors"
                  style={{ border: '1px dashed #2A2A42', background: '#0E0E1A' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#FF4500'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#2A2A42'}
                >
                  <span className="font-mono text-xs text-ghost/60 tracking-widest mb-1">[ UPLOAD CHALLENGE FILE ]</span>
                  <span className="font-mono text-[10px] text-ghost/30">Max {max_upload_mb}MB — {(allowed_file_types || 'zip,pdf,txt,png,jpg,bin,elf').split(',').slice(0,5).join(', ')}...</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={fileAccept}
                    onChange={e => setStagedFile(e.target.files[0] || null)}
                  />
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setFormOpen(false); setForm({ ...CC_EMPTY }) }}
                className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-2 rounded-sm tracking-widest transition-all"
              >
                CANCEL
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
              >
                {creating ? 'STAGING...' : 'STAGE CC'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Staged CCs */}
      <div className="border border-ghost/20 rounded-sm">
        <div className="px-4 py-2 border-b border-ghost/10 bg-abyss">
          <span className="font-mono text-xs text-ghost tracking-widest">STAGED ({staged.length})</span>
        </div>
        {staged.length === 0 ? (
          <div className="px-4 py-5 text-center">
            <p className="font-mono text-xs text-ghost/40 tracking-widest">NO STAGED CONTRACTS</p>
          </div>
        ) : (
          <div className="divide-y divide-ghost/10">
            {staged.map(cc => (
              <div key={cc.id} className="flex items-center justify-between px-4 py-3 flex-wrap gap-3">
                <div>
                  <p className="font-mono text-sm text-bone">{cc.title}</p>
                  <p className="font-mono text-xs text-ghost/50 mt-0.5">
                    {cc.category} · {cc.duration_minutes}min
                    {cc.bc_reward != null && (
                      <span className="ml-2 text-ember font-bold">· {cc.bc_reward} BC</span>
                    )}
                    {cc.has_attachment && (
                      <span className="ml-2 text-ghost/40">· {cc.attachment_filename} ({fmt_size(cc.attachment_size)})</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleActivate(cc.id)}
                  disabled={!!active}
                  className="font-mono text-xs text-success border border-success/40 hover:border-success hover:bg-success/10 px-3 py-1.5 rounded-sm tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title={active ? 'Another CC is already active' : 'Deploy this CC'}
                >
                  DEPLOY
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="border border-ghost/20 rounded-sm">
          <div className="px-4 py-2 border-b border-ghost/10 bg-abyss">
            <span className="font-mono text-xs text-ghost tracking-widest">HISTORY</span>
          </div>
          <div className="divide-y divide-ghost/10">
            {history.map(cc => (
              <div key={cc.id} className="flex items-center justify-between px-4 py-3 flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-bone/70">{cc.title}</span>
                    <span className={`font-mono text-[10px] border px-1.5 py-0.5 rounded-sm ${CC_STATUS_COLOR[cc.status]}`}>
                      {cc.status}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-ghost/40 mt-0.5">
                    {cc.category} · {cc.duration_minutes}min
                    {cc.bc_reward != null && <span className="text-ember/60"> · {cc.bc_reward} BC reward</span>}
                    {' · '}{cc.claim_count} claimed · {cc.bc_distributed} BC distributed
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


// ---------------------------------------------------------------------------
// ConfirmDialog
// ---------------------------------------------------------------------------
function ConfirmDialog({ message, detail, confirmLabel = 'CONFIRM', confirmClass, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-void/90">
      <div className="border border-ghost/30 bg-abyss rounded-sm p-6 max-w-sm w-full mx-4 space-y-4">
        <p className="font-mono text-sm text-bone">{message}</p>
        {detail && <p className="font-mono text-xs text-ghost">{detail}</p>}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-2 rounded-sm tracking-widest transition-all"
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 font-mono text-xs border px-4 py-2 rounded-sm tracking-widest transition-all ${confirmClass || 'text-ember border-ember/40 hover:border-ember hover:bg-ember/10'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContractCard — grid view card
// ---------------------------------------------------------------------------
function ContractCard({ contract, onOpen, onTogglePublish, onDelete, onArchive }) {
  const cfg = RARITY_CONFIG[contract.rarity] || RARITY_CONFIG.COMMON
  const canEdit = contract.can_edit !== false
  const isMajor = contract.is_blocked_for_own_org
  const hasDecay = contract.current_bc_value != null && contract.current_bc_value !== contract.base_bc_value
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={() => onOpen(contract)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative rounded-sm p-4 cursor-pointer border-l-[3px]"
      style={{
        borderLeftColor: cfg.border,
        border: `1px solid ${hovered ? cfg.border + '55' : 'rgba(107,107,128,0.2)'}`,
        borderLeft: `3px solid ${cfg.border}`,
        background: hovered ? 'rgba(255,69,0,0.03)' : 'transparent',
        transform: hovered ? 'scale(1.015)' : 'scale(1)',
        boxShadow: cfg.glow ? `0 0 ${hovered ? 20 : 10}px ${cfg.border}25` : undefined,
        transition: 'all 0.15s ease',
      }}
    >
      {/* Rarity + Status */}
      <div className="flex items-center justify-between mb-3">
        <span
          className="font-mono text-[9px] tracking-widest px-1.5 py-0.5 border"
          style={{ color: cfg.text, borderColor: cfg.border + '55' }}
        >
          {contract.rarity}
        </span>
        <span className={`font-mono text-[9px] tracking-widest ${contract.is_published ? 'text-success' : 'text-ghost/40'}`}>
          {contract.is_published ? '● LIVE' : '○ DRAFT'}
        </span>
      </div>

      {/* Title + badges */}
      <div className="flex flex-wrap items-start gap-1.5 mb-1">
        <p className="font-mono text-sm text-bone font-bold leading-snug">{contract.title}</p>
        {isMajor && <span className="font-mono text-[9px] text-flare border border-flare/30 px-1 rounded-sm shrink-0">MAJOR</span>}
      </div>

      {/* Category */}
      <p className="font-mono text-[10px] text-ghost mb-3">{contract.category}</p>

      {/* BC display */}
      <div className="flex items-center gap-1.5 mb-4">
        {hasDecay ? (
          <>
            <span className="font-mono text-xs text-ghost/40 line-through">{contract.base_bc_value}</span>
            <span className="font-mono text-[10px] text-ghost/30">→</span>
            <span className="font-mono text-sm font-bold" style={{ color: '#FF6B00' }}>{contract.current_bc_value}</span>
          </>
        ) : (
          <span className="font-mono text-sm font-bold text-ember">{contract.base_bc_value}</span>
        )}
        <span className="font-mono text-[10px] text-ghost/40">BC</span>
      </div>

      {/* Action buttons */}
      {canEdit && (
        <div className="flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onOpen(contract)}
            className="font-mono text-[10px] text-ghost hover:text-ember border border-ghost/20 hover:border-ember px-2 py-0.5 rounded-sm transition-all"
          >
            EDIT
          </button>
          <button
            onClick={() => onTogglePublish(contract)}
            className={`font-mono text-[10px] border px-2 py-0.5 rounded-sm transition-all ${
              contract.is_published
                ? 'text-ghost hover:text-bone border-ghost/20 hover:border-ghost'
                : 'text-success hover:text-success border-success/40 hover:border-success'
            }`}
          >
            {contract.is_published ? 'UNPUB' : 'PUB'}
          </button>
          {onArchive && (
            <button
              onClick={() => onArchive(contract)}
              className="font-mono text-[10px] text-ghost hover:text-flare border border-ghost/20 hover:border-flare/50 px-2 py-0.5 rounded-sm transition-all"
              title="Archive this contract for future reuse"
            >
              ARCH
            </button>
          )}
          <button
            onClick={() => onDelete(contract.id)}
            className="font-mono text-[10px] text-ghost hover:text-danger border border-ghost/20 hover:border-danger px-2 py-0.5 rounded-sm transition-all"
          >
            DEL
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SlideOutPanel — inline edit panel sliding from the right
// ---------------------------------------------------------------------------
function SlideOutPanel({ contract, onClose, onSaved, onDelete, onFileUploaded }) {
  const { allowed_file_types, max_upload_mb } = usePlatformFormat()
  const _exts = (allowed_file_types || 'zip,pdf,txt,png,jpg,bin,elf').split(',').map(e => e.trim().replace(/^\./, '')).filter(Boolean)
  const fileAccept = [
    ..._exts.map(e => `.${e}`),
    ...(_exts.some(e => ['bin','elf','exe','so','dll'].includes(e)) ? ['application/octet-stream','application/x-executable'] : []),
  ].join(',')

  const isMajor = contract.is_blocked_for_own_org
  const canEdit = contract.can_edit !== false

  const initialForm = {
    title:         contract.title,
    description:   contract.description || '',
    category:      contract.category,
    rarity:        contract.rarity,
    base_bc_value: contract.base_bc_value,
    is_published:  contract.is_published,
    flag:          '',
    max_attempts:  contract.max_attempts ?? 0,
    intel_drops:   contract.intel_drops?.length ? [...contract.intel_drops] : [],
  }

  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showFlag, setShowFlag] = useState(false)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [localAttachments, setLocalAttachments] = useState(contract.attachments || [])
  const [removingAttachment, setRemovingAttachment] = useState(null)
  const fileRef = useRef()

  const dirty = useMemo(() => {
    const cur = JSON.stringify({
      title: form.title, description: form.description, category: form.category,
      rarity: form.rarity, base_bc_value: form.base_bc_value,
      is_published: form.is_published, intel_drops: form.intel_drops,
    })
    const orig = JSON.stringify({
      title: initialForm.title, description: initialForm.description, category: initialForm.category,
      rarity: initialForm.rarity, base_bc_value: initialForm.base_bc_value,
      is_published: initialForm.is_published, intel_drops: initialForm.intel_drops,
    })
    return cur !== orig || form.flag !== ''
  }, [form]) // eslint-disable-line

  const cfg = RARITY_CONFIG[form.rarity] || RARITY_CONFIG.COMMON

  function handleClose() {
    if (dirty) setDiscardConfirm(true)
    else onClose()
  }

  function setDrop(i, field, val) {
    setForm(f => {
      const drops = [...f.intel_drops]
      drops[i] = { ...drops[i], [field]: val }
      return { ...f, intel_drops: drops }
    })
  }
  function addDrop() {
    if (form.intel_drops.length >= 3) return
    setForm(f => ({ ...f, intel_drops: [...f.intel_drops, { content: '', cost_bc: 30 }] }))
  }
  function removeDrop(i) {
    setForm(f => ({ ...f, intel_drops: f.intel_drops.filter((_, idx) => idx !== i) }))
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        title:         form.title,
        description:   form.description,
        category:      form.category,
        rarity:        form.rarity,
        base_bc_value: form.base_bc_value,
        is_published:  form.is_published,
        intel_drops:   form.intel_drops.filter(d => d.content.trim()),
      }
      if (form.flag.trim()) payload.flag = form.flag.trim()
      const res = await client.put(`/contractor/contracts/${contract.id}`, payload)
      await onSaved(res.data?.flag_variants || null)
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload() {
    if (!uploadFile) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', uploadFile)
    try {
      const res = await client.post(`/contracts/${contract.id}/attachments`, fd, { headers: { 'Content-Type': undefined } })
      setLocalAttachments(prev => [...prev, res.data])
      setUploadFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setUploadMsg(`✓ ${uploadFile.name} uploaded`)
      setTimeout(() => setUploadMsg(''), 3000)
      onFileUploaded?.()
    } catch {
      setError('Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveAttachment(stored) {
    setRemovingAttachment(stored)
    try {
      await client.delete(`/contractor/contracts/${contract.id}/attachments/${stored}`)
      setLocalAttachments(prev => prev.filter(a => a.stored !== stored))
      onFileUploaded?.()
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Remove failed.')
    } finally {
      setRemovingAttachment(null)
    }
  }

  const activeDrop = form.intel_drops.filter(d => d.content.trim()).length

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-40 bg-void/70"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={handleClose}
      />

      {/* Panel */}
      <motion.div
        className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[480px] flex flex-col border-l border-ghost/20"
        style={{ background: '#0C0C14' }}
        initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }}
        transition={{ type: 'tween', duration: 0.22 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ghost/10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span
              className="font-mono text-[9px] tracking-widest px-1.5 py-0.5 border"
              style={{ color: cfg.text, borderColor: cfg.border + '55' }}
            >
              {form.rarity}
            </span>
            {isMajor && <span className="font-mono text-[9px] text-flare border border-flare/30 px-1 rounded-sm">MAJOR</span>}
            <span className={`font-mono text-[9px] ${form.is_published ? 'text-success' : 'text-ghost/40'}`}>
              {form.is_published ? '● LIVE' : '○ DRAFT'}
            </span>
          </div>
          <button onClick={handleClose} className="font-mono text-ghost hover:text-bone text-xl leading-none">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {error && (
            <div className="font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">{error}</div>
          )}
          {uploadMsg && (
            <div className="font-mono text-xs text-success border border-success/30 bg-success/10 rounded-sm px-3 py-2">{uploadMsg}</div>
          )}

          {/* Title */}
          <div>
            <label className="font-mono text-[10px] text-ghost/60 tracking-widest block mb-1">TITLE</label>
            <input
              className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              disabled={!canEdit}
            />
          </div>

          {/* ── DETAILS */}
          <p className="font-mono text-[10px] text-ghost/35 tracking-widest border-b border-ghost/10 pb-1">── DETAILS</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-ghost/60 tracking-widest block mb-1">CATEGORY</label>
              <select
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                disabled={!canEdit}
              >
                {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="font-mono text-[10px] text-ghost/60 tracking-widest block mb-1">RARITY</label>
              <select
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember"
                value={form.rarity}
                onChange={e => setForm(f => ({ ...f, rarity: e.target.value }))}
                disabled={!canEdit}
              >
                {RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-ghost/60 tracking-widest block mb-1">BASE BC</label>
              <input
                type="number"
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={form.base_bc_value}
                onChange={e => setForm(f => ({ ...f, base_bc_value: parseInt(e.target.value) || 0 }))}
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className="font-mono text-[10px] text-ghost/60 tracking-widest block mb-1">
                MAX ATTEMPTS <span className="text-ghost/30 normal-case tracking-normal">(0=∞)</span>
              </label>
              <input
                type="number"
                min="0"
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                value={form.max_attempts}
                onChange={e => setForm(f => ({ ...f, max_attempts: Math.max(0, parseInt(e.target.value) || 0) }))}
                disabled={!canEdit}
              />
            </div>
          </div>
          <div>
            <label className="font-mono text-[10px] text-ghost/60 tracking-widest block mb-1">STATUS</label>
            <button
              onClick={() => canEdit && setForm(f => ({ ...f, is_published: !f.is_published }))}
              className={`w-full flex items-center gap-2 px-3 py-2 border rounded-sm font-mono text-xs transition-colors ${
                form.is_published ? 'border-success/40 text-success bg-success/5' : 'border-ghost/20 text-ghost'
              } ${!canEdit ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${form.is_published ? 'bg-success' : 'bg-ghost/30'}`} />
              {form.is_published ? 'PUBLISHED' : 'DRAFT'}
            </button>
          </div>

          {/* ── DESCRIPTION */}
          <p className="font-mono text-[10px] text-ghost/35 tracking-widest border-b border-ghost/10 pb-1">── DESCRIPTION</p>
          <textarea
            rows={5}
            className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-xs text-bone focus:outline-none focus:border-ember resize-y"
            placeholder="Markdown supported..."
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            disabled={!canEdit}
          />

          {/* ── FLAG */}
          <p className="font-mono text-[10px] text-ghost/35 tracking-widest border-b border-ghost/10 pb-1">── FLAG</p>
          {isMajor ? (
            <div className="space-y-2">
              <div className="border border-flare/20 bg-flare/5 rounded-sm px-3 py-2">
                <p className="font-mono text-[10px] text-flare/80">
                  MAJOR EVENT — Per-org flag variants are active. Enter a new base flag to regenerate all variants.
                </p>
              </div>
              <div className="relative">
                <input
                  type={showFlag ? 'text' : 'password'}
                  className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 pr-14 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                  placeholder="New base flag — leave blank to keep current"
                  value={form.flag}
                  onChange={e => setForm(f => ({ ...f, flag: e.target.value }))}
                />
                <button
                  onClick={() => setShowFlag(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ghost hover:text-bone tracking-widest"
                >
                  {showFlag ? 'HIDE' : 'SHOW'}
                </button>
              </div>
              <p className="font-mono text-[10px] text-ghost/40">Saving with a flag will invalidate existing org variants.</p>
            </div>
          ) : (
            <div className="relative">
              <input
                type={showFlag ? 'text' : 'password'}
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 pr-14 font-mono text-sm text-bone focus:outline-none focus:border-ember"
                placeholder="DEADNET{...} — leave blank to keep current"
                value={form.flag}
                onChange={e => setForm(f => ({ ...f, flag: e.target.value }))}
                disabled={!canEdit}
              />
              <button
                onClick={() => setShowFlag(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ghost hover:text-bone tracking-widest"
              >
                {showFlag ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          )}

          {/* ── INTEL DROPS */}
          <div>
            <div className="flex items-center justify-between border-b border-ghost/10 pb-1 mb-3">
              <p className="font-mono text-[10px] text-ghost/35 tracking-widest">── INTEL DROPS ({form.intel_drops.length}/3)</p>
              {canEdit && form.intel_drops.length < 3 && (
                <button onClick={addDrop} className="font-mono text-[10px] text-ember hover:text-flare tracking-widest">+ ADD DROP</button>
              )}
            </div>
            <div className="space-y-2">
              {form.intel_drops.length === 0 && (
                <p className="font-mono text-[10px] text-ghost/30 tracking-widest">No intel drops.</p>
              )}
              {form.intel_drops.map((drop, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-ghost/40 w-5 shrink-0">#{i + 1}</span>
                  <input
                    value={drop.content}
                    onChange={e => setDrop(i, 'content', e.target.value)}
                    placeholder="Hint text..."
                    disabled={!canEdit}
                    className="flex-1 min-w-0 bg-void border border-ghost/20 rounded-sm px-2 py-1.5 font-mono text-xs text-bone focus:outline-none focus:border-ember"
                  />
                  <input
                    type="number"
                    value={drop.cost_bc}
                    onChange={e => setDrop(i, 'cost_bc', parseInt(e.target.value) || 0)}
                    disabled={!canEdit}
                    className="w-14 shrink-0 bg-void border border-ghost/20 rounded-sm px-2 py-1.5 font-mono text-xs text-bone focus:outline-none focus:border-ember text-center"
                  />
                  <span className="font-mono text-[10px] text-ghost/40 shrink-0">BC</span>
                  {canEdit && (
                    <button onClick={() => removeDrop(i)} className="font-mono text-xs text-ghost/40 hover:text-danger shrink-0">✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── ATTACHMENTS */}
          <div>
            <p className="font-mono text-[10px] text-ghost/35 tracking-widest border-b border-ghost/10 pb-1 mb-3">── ATTACHMENTS</p>
            {localAttachments.length > 0 ? (
              <div className="flex flex-col gap-1.5 mb-3">
                {localAttachments.map((att, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border border-ghost/20 rounded-sm px-2 py-0.5">
                    <span className="font-mono text-xs text-bone/60 truncate">
                      📎 {att.original || att.original_filename || att}
                    </span>
                    {canEdit && (
                      <button
                        onClick={() => handleRemoveAttachment(att.stored)}
                        disabled={removingAttachment === att.stored}
                        className="font-mono text-[10px] text-ghost/50 hover:text-danger tracking-widest shrink-0 transition-colors disabled:opacity-40"
                      >
                        {removingAttachment === att.stored ? '...' : '✕ REMOVE'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-mono text-[10px] text-ghost/30 mb-3">No attachments.</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept={fileAccept}
                onChange={e => setUploadFile(e.target.files[0])}
                className="font-mono text-xs text-ghost file:mr-2 file:font-mono file:text-xs file:text-ghost file:border file:border-ghost/20 file:bg-void file:rounded-sm file:px-2 file:py-0.5 file:cursor-pointer"
              />
              {uploadFile && (
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-3 py-1 rounded-sm tracking-widest transition-all disabled:opacity-50"
                >
                  {uploading ? 'UPLOADING...' : 'UPLOAD'}
                </button>
              )}
            </div>
          </div>

          {/* ── OPERATIVE VIEW (preview) */}
          <div>
            <p className="font-mono text-[10px] text-ghost/35 tracking-widest border-b border-ghost/10 pb-1 mb-3">── OPERATIVE VIEW</p>
            <div
              className="rounded-sm p-4"
              style={{
                background: '#08080F',
                borderLeft: `3px solid ${cfg.border}`,
                border: `1px solid ${cfg.border}30`,
                borderLeftColor: cfg.border,
                borderLeftWidth: 3,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="font-mono text-[9px] tracking-widest px-1.5 py-0.5 border"
                  style={{ color: cfg.text, borderColor: cfg.border + '55' }}
                >
                  {form.rarity}
                </span>
                <span className="font-mono text-sm font-bold text-ember">{form.base_bc_value} BC</span>
              </div>
              <p className="font-mono text-sm text-bone font-bold mb-0.5">{form.title || '—'}</p>
              <p className="font-mono text-[10px] text-ghost mb-2">{form.category}</p>
              <p className="font-mono text-xs text-ghost/55 leading-relaxed line-clamp-3">
                {form.description || 'No description provided.'}
              </p>
              {activeDrop > 0 && (
                <p className="font-mono text-[10px] text-ghost/35 mt-2">
                  {activeDrop} intel drop{activeDrop !== 1 ? 's' : ''} available
                </p>
              )}
            </div>
            <p className="font-mono text-[9px] text-ghost/25 tracking-widest mt-1">PREVIEW — NOT LIVE</p>
          </div>
        </div>

        {/* Footer */}
        {canEdit && (
          <div className="flex items-center gap-2 px-5 py-4 border-t border-ghost/10 flex-shrink-0">
            <button
              onClick={() => onDelete(contract.id)}
              className="font-mono text-[10px] text-ghost hover:text-danger border border-ghost/20 hover:border-danger px-3 py-2 rounded-sm tracking-widest transition-all"
            >
              DELETE
            </button>
            <div className="flex-1" />
            <button
              onClick={handleClose}
              className="font-mono text-xs text-ghost border border-ghost/20 hover:border-ghost px-4 py-2 rounded-sm tracking-widest transition-all"
            >
              DISCARD
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
            >
              {saving ? 'SAVING...' : 'SAVE CHANGES'}
            </button>
          </div>
        )}

        {/* Discard confirm — overlays the panel itself */}
        {discardConfirm && (
          <ConfirmDialog
            message="DISCARD CHANGES?"
            detail="You have unsaved changes. They will be lost."
            confirmLabel="DISCARD"
            onConfirm={onClose}
            onCancel={() => setDiscardConfirm(false)}
          />
        )}
      </motion.div>
    </>
  )
}

// ---------------------------------------------------------------------------
// ContractsTab
// ---------------------------------------------------------------------------
function ContractsTab({ contracts, events, loadContracts, setFlagVariants, onNewContract, isAdmin }) {
  const [view, setView] = useState('grid')
  const [sortBy, setSortBy] = useState('rarity')
  const [filterCategory, setFilterCategory] = useState('ALL')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [panel, setPanel] = useState(null)         // { contract } | null
  const [panelLoading, setPanelLoading] = useState(false)
  const [confirm, setConfirm] = useState(null)     // ConfirmDialog props | null
  const [actionError, setActionError] = useState('')

  const availableCategories = useMemo(
    () => [...new Set(contracts.map(c => c.category))].sort(),
    [contracts]
  )

  const processed = useMemo(
    () => applyFiltersAndSort(contracts, { filterCategory, filterStatus, sortBy }),
    [contracts, filterCategory, filterStatus, sortBy]
  )

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE))
  const paginated  = processed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [filterCategory, filterStatus, sortBy])

  async function openPanel(c) {
    setPanelLoading(true)
    try {
      const res = await client.get(`/contractor/contracts/${c.id}`)
      setPanel({ contract: res.data })
    } catch {
      setActionError('Failed to load contract details.')
    } finally {
      setPanelLoading(false)
    }
  }

  function requestTogglePublish(c) {
    setConfirm({
      message: c.is_published ? 'UNPUBLISH CONTRACT?' : 'PUBLISH CONTRACT?',
      detail:  c.is_published
        ? 'This contract will be hidden from Operatives.'
        : 'This contract will go live to all Operatives.',
      confirmLabel: c.is_published ? 'UNPUBLISH' : 'PUBLISH',
      onConfirm: async () => {
        setConfirm(null)
        try {
          await client.patch(`/contractor/contracts/${c.id}/publish`)
          await loadContracts()
        } catch { setActionError('Toggle failed.') }
      },
    })
  }

  function requestDelete(id) {
    setConfirm({
      message:      'DELETE CONTRACT?',
      detail:       'This contract will be permanently deleted. This cannot be undone.',
      confirmLabel: 'DELETE',
      confirmClass: 'text-danger border-danger/40 hover:border-danger hover:bg-danger/10',
      onConfirm: async () => {
        setConfirm(null)
        try {
          await client.delete(`/contractor/contracts/${id}`)
          setPanel(null)
          await loadContracts()
        } catch { setActionError('Delete failed.') }
      },
    })
  }

  function requestArchive(contract) {
    setConfirm({
      message:      'ARCHIVE CONTRACT?',
      detail:       `"${contract.title}" will be unpublished and moved to the contract archive. It can be redeployed to future events from the Admin ARCHIVE tab.`,
      confirmLabel: 'ARCHIVE',
      confirmClass: 'text-flare border-flare/40 hover:border-flare hover:bg-flare/10',
      onConfirm: async () => {
        setConfirm(null)
        try {
          await client.post(`/admin/contracts/${contract.id}/archive`)
          setPanel(null)
          await loadContracts()
        } catch { setActionError('Archive failed.') }
      },
    })
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={onNewContract}
          className="font-mono text-xs text-ember border border-ember/40 hover:border-ember hover:bg-ember/10 px-4 py-2 rounded-sm tracking-widest transition-all"
        >
          + NEW CONTRACT
        </button>
      </div>

      {actionError && (
        <div className="mb-4 font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">
          {actionError}
          <button className="ml-3 underline" onClick={() => setActionError('')}>dismiss</button>
        </div>
      )}

      {/* Filter + sort bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="bg-abyss border border-ghost/20 rounded-sm px-3 py-1.5 font-mono text-xs text-ghost focus:outline-none focus:border-ember shrink-0"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Category + status pills */}
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          {['ALL', ...availableCategories].map(cat => (
            <button
              key={cat}
              onClick={() => { setFilterCategory(cat); setFilterStatus('ALL') }}
              className={`font-mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border transition-all whitespace-nowrap ${
                filterCategory === cat && filterStatus === 'ALL'
                  ? 'border-ember text-ember'
                  : 'border-ghost/20 text-ghost hover:border-ghost/40'
              }`}
            >
              {cat}
            </button>
          ))}
          <button
            onClick={() => { setFilterStatus(s => s === 'PUBLISHED' ? 'ALL' : 'PUBLISHED'); setFilterCategory('ALL') }}
            className={`font-mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border transition-all whitespace-nowrap ${
              filterStatus === 'PUBLISHED' ? 'border-success text-success' : 'border-ghost/20 text-ghost hover:border-ghost/40'
            }`}
          >
            PUBLISHED
          </button>
          <button
            onClick={() => { setFilterStatus(s => s === 'DRAFT' ? 'ALL' : 'DRAFT'); setFilterCategory('ALL') }}
            className={`font-mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border transition-all whitespace-nowrap ${
              filterStatus === 'DRAFT' ? 'border-ghost text-bone' : 'border-ghost/20 text-ghost hover:border-ghost/40'
            }`}
          >
            DRAFT
          </button>
        </div>

        {/* Grid / List toggle */}
        <div className="flex border border-ghost/20 rounded-sm overflow-hidden shrink-0">
          <button
            onClick={() => setView('grid')}
            title="Grid view"
            className={`px-3 py-1.5 font-mono text-sm transition-colors ${view === 'grid' ? 'bg-ember/20 text-ember' : 'text-ghost hover:text-bone'}`}
          >⊞</button>
          <button
            onClick={() => setView('list')}
            title="List view"
            className={`px-3 py-1.5 font-mono text-sm border-l border-ghost/20 transition-colors ${view === 'list' ? 'bg-ember/20 text-ember' : 'text-ghost hover:text-bone'}`}
          >≡</button>
        </div>
      </div>

      {/* Empty states */}
      {contracts.length === 0 ? (
        <div className="border border-ghost/20 rounded-sm py-16 text-center">
          <p className="font-mono text-xs text-ghost tracking-widest">NO CONTRACTS YET</p>
        </div>
      ) : processed.length === 0 ? (
        <div className="border border-ghost/20 rounded-sm py-10 text-center">
          <p className="font-mono text-xs text-ghost tracking-widest">NO CONTRACTS MATCH CURRENT FILTERS</p>
        </div>
      ) : view === 'grid' ? (
        /* ── GRID VIEW ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map(c => (
            <ContractCard
              key={c.id}
              contract={c}
              onOpen={openPanel}
              onTogglePublish={requestTogglePublish}
              onDelete={requestDelete}
              onArchive={isAdmin ? requestArchive : undefined}
            />
          ))}
        </div>
      ) : (
        /* ── LIST VIEW ── */
        <div className="border border-ghost/20 rounded-sm overflow-x-auto">
          <div className={`${LIST_COLS} px-4 py-2 border-b border-ghost/10 bg-abyss min-w-[760px]`}>
            {['TITLE', 'CATEGORY', 'RARITY', 'BASE BC', 'NOW BC', 'ACTIONS'].map(h => (
              <span key={h} className="font-mono text-[10px] text-ghost tracking-widest whitespace-nowrap">{h}</span>
            ))}
          </div>
          <div className="divide-y divide-ghost/10">
            {paginated.map(c => {
              const lcfg = RARITY_CONFIG[c.rarity] || RARITY_CONFIG.COMMON
              const canEdit = c.can_edit !== false
              const isMajor = c.is_blocked_for_own_org
              const hasDecay = c.current_bc_value != null && c.current_bc_value !== c.base_bc_value
              return (
                <div
                  key={c.id}
                  onClick={() => openPanel(c)}
                  className={`${LIST_COLS} px-4 py-3 items-center cursor-pointer hover:bg-abyss/60 transition-colors min-w-[760px] border-l-[3px]`}
                  style={{ borderLeftColor: lcfg.border, opacity: c.is_published ? 1 : 0.65 }}
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-mono text-sm text-bone truncate">{c.title}</span>
                    {isMajor && <span className="font-mono text-[9px] text-flare border border-flare/30 px-1 rounded-sm shrink-0">MAJOR</span>}
                    {!c.is_published && <span className="font-mono text-[10px] text-ghost/50 border border-ghost/20 px-1 rounded-sm shrink-0">DRAFT</span>}
                  </div>
                  <span className="font-mono text-xs text-ghost whitespace-nowrap">{c.category}</span>
                  <span className="font-mono text-xs whitespace-nowrap" style={{ color: lcfg.text }}>{c.rarity}</span>
                  <span className="font-mono text-xs text-ghost whitespace-nowrap">{c.base_bc_value}</span>
                  <span className={`font-mono text-xs font-bold whitespace-nowrap ${hasDecay ? 'text-flare' : 'text-ember'}`}>
                    {c.current_bc_value ?? c.base_bc_value}
                  </span>
                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => requestTogglePublish(c)}
                          className={`font-mono text-[10px] border px-2 py-0.5 rounded-sm transition-all ${
                            c.is_published
                              ? 'text-ghost hover:text-bone border-ghost/20 hover:border-ghost'
                              : 'text-success hover:text-success border-success/40 hover:border-success'
                          }`}
                        >
                          {c.is_published ? 'UNPUB' : 'PUB'}
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => requestArchive(c)}
                            className="font-mono text-[10px] text-ghost hover:text-flare border border-ghost/20 hover:border-flare/50 px-2 py-0.5 rounded-sm transition-all"
                          >
                            ARCH
                          </button>
                        )}
                        <button
                          onClick={() => requestDelete(c.id)}
                          className="font-mono text-[10px] text-ghost hover:text-danger border border-ghost/20 hover:border-danger px-2 py-0.5 rounded-sm transition-all"
                        >
                          DEL
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="font-mono text-xs text-ghost border border-ghost/20 px-3 py-1.5 rounded-sm hover:border-ghost transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← PREV
          </button>
          <span className="font-mono text-xs text-ghost">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="font-mono text-xs text-ghost border border-ghost/20 px-3 py-1.5 rounded-sm hover:border-ghost transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            NEXT →
          </button>
        </div>
      )}

      {/* Slide-out panel */}
      <AnimatePresence>
        {panel && (
          <SlideOutPanel
            contract={panel.contract}
            onClose={() => setPanel(null)}
            onSaved={async (variants) => {
              await loadContracts()
              setPanel(null)
              if (variants?.length) setFlagVariants(variants)
            }}
            onDelete={requestDelete}
            onFileUploaded={loadContracts}
          />
        )}
      </AnimatePresence>

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          detail={confirm.detail}
          confirmLabel={confirm.confirmLabel}
          confirmClass={confirm.confirmClass}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Panel loading overlay */}
      {panelLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-void/50">
          <span className="font-mono text-ghost animate-pulse tracking-widest text-xs">LOADING...</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContractorDashboard
// ---------------------------------------------------------------------------
export default function ContractorDashboard() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [tab, setTab] = useState('contracts')
  const [contracts, setContracts] = useState([])
  const [events, setEvents] = useState([])
  const [transmissions, setTransmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)         // null | { mode: 'create' }
  const [flagVariants, setFlagVariants] = useState(null)
  const [boardContracts, setBoardContracts] = useState([])
  const [boardViewing, setBoardViewing] = useState(null)
  const [txContent, setTxContent] = useState('')
  const [txSending, setTxSending] = useState(false)
  const [txError, setTxError] = useState('')
  const [txMode, setTxMode] = useState('all')      // 'all' | 'roles' | 'specific'
  const [selectedRoles, setSelectedRoles] = useState(new Set())
  const [operatives, setOperatives] = useState([])
  const [opSearch, setOpSearch] = useState('')
  const [selectedOps, setSelectedOps] = useState(new Set())
  const TARGETABLE_ROLES = ['OPERATIVE', 'CONTRACTOR', 'HANDLER', 'ARCHITECT']

  async function loadContracts() {
    const res = await client.get('/contractor/contracts')
    setContracts(res.data)
  }

  async function loadBoard() {
    try {
      const res = await client.get('/contractor/board')
      setBoardContracts(res.data)
    } catch { /* ignore */ }
  }

  async function loadEvents() {
    try {
      const res = await client.get('/contractor/events')
      setEvents(res.data)
    } catch { /* ignore */ }
  }

  async function loadTransmissions() {
    const res = await client.get('/transmissions/')
    setTransmissions(res.data)
  }

  useEffect(() => {
    Promise.all([
      loadContracts(),
      loadBoard(),
      loadEvents(),
      loadTransmissions(),
      client.get('/operatives/').then(r => setOperatives(r.data)).catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function switchTxMode(mode) {
    setTxMode(mode)
    setSelectedOps(new Set())
    setSelectedRoles(new Set())
    setOpSearch('')
  }

  function toggleRole(role) {
    setSelectedRoles(prev => {
      const next = new Set(prev)
      next.has(role) ? next.delete(role) : next.add(role)
      return next
    })
  }

  function toggleOp(id) {
    setSelectedOps(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filteredOps = operatives.filter(o =>
    o.username.toLowerCase().includes(opSearch.toLowerCase())
  )

  async function sendTransmission() {
    if (!txContent.trim()) return
    if (txMode === 'roles' && selectedRoles.size === 0) { setTxError('Select at least one role.'); return }
    if (txMode === 'specific' && selectedOps.size === 0) { setTxError('Select at least one operative.'); return }
    setTxSending(true)
    setTxError('')
    try {
      const payload = { content: txContent.trim() }
      if (txMode === 'roles')    payload.target_roles  = [...selectedRoles]
      if (txMode === 'specific') payload.recipient_ids = [...selectedOps]
      await client.post('/transmissions/', payload)
      setTxContent('')
      setSelectedOps(new Set())
      setSelectedRoles(new Set())
      setOpSearch('')
      await loadTransmissions()
    } catch {
      setTxError('Transmission failed.')
    } finally {
      setTxSending(false)
    }
  }

  if (loading) {
    return (
      <div className="relative min-h-screen bg-void text-bone flex flex-col">
        <Scanlines />
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <span className="font-mono text-ghost animate-pulse tracking-widest">LOADING CONTRACT HANDLER...</span>
        </div>
        <Footer />
      </div>
    )
  }

  const published = contracts.filter(c => c.is_published).length
  const drafts    = contracts.filter(c => !c.is_published).length

  return (
    <div className="relative min-h-screen bg-void text-bone flex flex-col">
      <Scanlines />
      <Navbar />

      {flagVariants && (
        <FlagVariantsModal
          variants={flagVariants}
          onClose={() => setFlagVariants(null)}
        />
      )}

      {boardViewing && (
        <BoardContractModal
          contract={boardViewing}
          onClose={() => setBoardViewing(null)}
        />
      )}

      {modal?.mode === 'create' && (
        <ContractFormModal
          contract={null}
          onClose={() => setModal(null)}
          onSaved={async (variants) => {
            setModal(null)
            await loadContracts()
            if (variants?.length) setFlagVariants(variants)
          }}
          onFileUploaded={loadContracts}
          events={events}
        />
      )}

      <div className="relative z-10 flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <p className="font-mono text-xs text-ghost tracking-widest mb-1">CONTRACTOR // CONTRACT HANDLER</p>
          <h1 className="font-mono font-bold text-3xl text-ember tracking-widest">CONTRACT HANDLER</h1>
        </div>

        {/* Stat row */}
        <div className="flex gap-3 flex-wrap mb-6">
          {[
            { label: 'TOTAL CONTRACTS', val: contracts.length },
            { label: 'PUBLISHED', val: published },
            { label: 'DRAFTS', val: drafts },
          ].map(s => (
            <div key={s.label} className="border border-ghost/20 bg-abyss rounded-sm px-5 py-4 flex-1 min-w-[120px]">
              <div className="font-mono font-bold text-2xl text-ember">{s.val}</div>
              <div className="font-mono text-[10px] text-ghost tracking-widest mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-ghost/20 mb-6">
          {[['contracts', 'CONTRACTS'], ['board', 'CONTRACT BOARD'], ['cc', 'EMERGENCY CONTRACTS'], ['transmissions', 'TRANSMISSIONS']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`font-mono text-xs tracking-widest px-5 py-2 border-b-2 transition-colors ${
                tab === key ? 'border-ember text-ember' : 'border-transparent text-ghost hover:text-bone'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* CONTRACTS TAB */}
        {tab === 'contracts' && (
          <ContractsTab
            contracts={contracts}
            events={events}
            loadContracts={loadContracts}
            setFlagVariants={setFlagVariants}
            onNewContract={() => { setFlagVariants(null); setModal({ mode: 'create' }) }}
            isAdmin={isAdmin}
          />
        )}

        {/* CONTRACT BOARD TAB */}
        {tab === 'board' && <BoardTab contracts={boardContracts} onView={setBoardViewing} />}

        {/* EMERGENCY CONTRACTS TAB */}
        {tab === 'cc' && <CCTab />}

        {/* TRANSMISSIONS TAB */}
        {tab === 'transmissions' && (
          <div className="space-y-4">
            {txError && (
              <div className="font-mono text-xs text-danger border border-danger/30 bg-danger/10 rounded-sm px-3 py-2">
                {txError}
                <button className="ml-3 underline" onClick={() => setTxError('')}>dismiss</button>
              </div>
            )}
            <div className="border border-ghost/20 bg-abyss rounded-sm p-4 space-y-3">
              {/* Mode selector */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-ghost tracking-widest">TARGET:</span>
                {[['all', 'ALL'], ['roles', 'BY ROLE'], ['specific', 'SPECIFIC OPERATIVE']].map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => switchTxMode(mode)}
                    className={`font-mono text-[10px] px-3 py-1 rounded-sm tracking-widest border transition-all ${
                      txMode === mode
                        ? 'border-ember text-ember bg-ember/10'
                        : 'border-ghost/30 text-ghost hover:border-ghost hover:text-bone'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Role picker */}
              {txMode === 'roles' && (
                <div className="flex flex-wrap gap-2">
                  {TARGETABLE_ROLES.map(role => (
                    <button
                      key={role}
                      onClick={() => toggleRole(role)}
                      className={`font-mono text-[10px] px-3 py-1.5 rounded-sm tracking-widest border transition-all ${
                        selectedRoles.has(role)
                          ? 'border-ember text-ember bg-ember/10'
                          : 'border-ghost/20 text-ghost hover:border-ghost/50 hover:text-bone'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                  {selectedRoles.size > 0 && (
                    <span className="font-mono text-[10px] text-ghost/50 self-center ml-1">
                      {[...selectedRoles].join(', ')} will see this
                    </span>
                  )}
                </div>
              )}

              {/* Specific operative picker */}
              {txMode === 'specific' && (
                <div className="border border-ghost/20 rounded-sm overflow-hidden">
                  <div className="px-3 py-2 border-b border-ghost/10 bg-void">
                    <input
                      type="text"
                      placeholder="Search operatives..."
                      value={opSearch}
                      onChange={e => setOpSearch(e.target.value)}
                      className="w-full bg-transparent font-mono text-xs text-bone placeholder:text-ghost focus:outline-none"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-ghost/10">
                    {filteredOps.length === 0 ? (
                      <p className="font-mono text-[10px] text-ghost px-3 py-2 tracking-widest">NO OPERATIVES FOUND</p>
                    ) : filteredOps.map(op => (
                      <label key={op.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-ghost/5">
                        <input type="checkbox" checked={selectedOps.has(op.id)} onChange={() => toggleOp(op.id)} className="accent-ember" />
                        <span className="font-mono text-xs text-bone">{op.username}</span>
                        <span className="font-mono text-[10px] text-ghost ml-auto">{op.bc_total} BC</span>
                      </label>
                    ))}
                  </div>
                  {selectedOps.size > 0 && (
                    <div className="px-3 py-1.5 border-t border-ghost/10 bg-void">
                      <span className="font-mono text-[10px] text-ember">{selectedOps.size} OPERATIVE{selectedOps.size > 1 ? 'S' : ''} SELECTED</span>
                    </div>
                  )}
                </div>
              )}

              <textarea
                rows={3}
                className="w-full bg-void border border-ghost/20 rounded-sm px-3 py-2 font-mono text-sm text-bone focus:outline-none focus:border-ember resize-none"
                placeholder={
                  txMode === 'all'   ? 'Network-wide transmission...' :
                  txMode === 'roles' ? 'Role-restricted transmission...' :
                                       'Targeted transmission...'
                }
                value={txContent}
                onChange={e => setTxContent(e.target.value)}
              />
              <div className="flex justify-end">
                <button
                  onClick={sendTransmission}
                  disabled={
                    txSending || !txContent.trim() ||
                    (txMode === 'roles' && selectedRoles.size === 0) ||
                    (txMode === 'specific' && selectedOps.size === 0)
                  }
                  className="font-mono text-xs text-ember border border-ember/40 hover:border-ember px-4 py-2 rounded-sm tracking-widest transition-all disabled:opacity-50"
                >
                  {txSending ? 'SENDING...' :
                   txMode === 'all'   ? 'BROADCAST' :
                   txMode === 'roles' ? `BROADCAST TO ${selectedRoles.size > 0 ? [...selectedRoles].join(', ') : '?'}` :
                                        `SEND TO ${selectedOps.size || '?'} OPERATIVE${selectedOps.size !== 1 ? 'S' : ''}`}
                </button>
              </div>
            </div>

            <div className="border border-ghost/20 rounded-sm overflow-hidden">
              <div className="px-4 py-2 border-b border-ghost/10 bg-abyss">
                <span className="font-mono text-xs text-ghost tracking-widest">TRANSMISSION HISTORY</span>
              </div>
              {transmissions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="font-mono text-xs text-ghost tracking-widest">NO TRANSMISSIONS YET</p>
                </div>
              ) : (
                <div className="divide-y divide-ghost/10">
                  {transmissions.map(tx => (
                    <div key={tx.id} className="px-4 py-3">
                      <p className="font-mono text-sm text-bone">{tx.content}</p>
                      <p className="font-mono text-[10px] text-ghost mt-1 flex items-center gap-2 flex-wrap">
                        <span>{tx.author_username}</span>
                        <span>·</span>
                        {tx.recipient_username
                          ? <span className="text-ember">→ {tx.recipient_username}</span>
                          : tx.target_roles?.length
                            ? <span className="text-flare">→ {tx.target_roles.join(', ')}</span>
                            : <span className="text-ghost/50">→ ALL</span>
                        }
                        <span>·</span>
                        <span>{new Date(tx.created_at).toLocaleString()}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}

// ---------------------------------------------------------------------------
// BoardTab — read-only view of all published contracts in the event
// ---------------------------------------------------------------------------
function BoardContractModal({ contract, onClose }) {
  const cfg = RARITY_CONFIG[contract.rarity] || RARITY_CONFIG.COMMON
  const isMajor = contract.event_type === 'MAJOR'

  // ESC to close
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    // Backdrop — click outside to close
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-void/90 px-4"
      onClick={onClose}
    >
      {/* Modal card — stop propagation so clicking inside doesn't close */}
      <div
        className="w-full max-w-2xl border border-ghost/30 bg-abyss rounded-sm max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ghost/20 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-mono text-xs tracking-widest ${cfg.text}`}>{contract.rarity}</span>
            <span className="font-mono text-xs text-ghost/40">·</span>
            <span className="font-mono text-xs text-ghost tracking-widest">{contract.category}</span>
            {isMajor && contract.org_name && contract.org_name !== '—' && (
              <>
                <span className="font-mono text-xs text-ghost/40">·</span>
                <span className="font-mono text-xs text-flare/80 tracking-widest">{contract.org_name}</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="font-mono text-sm text-ghost hover:text-ember border border-ghost/20 hover:border-ember/40 rounded-sm px-3 py-1 tracking-widest transition-colors shrink-0 ml-4"
          >
            ✕ CLOSE
          </button>
        </div>

        {/* Scrollable body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          <h2 className={`font-mono font-bold text-xl ${cfg.text}`}>{contract.title}</h2>

          {/* Creator + org */}
          <div className="flex items-center gap-4 text-xs font-mono flex-wrap">
            {contract.created_by_username && contract.created_by_username !== '—' && (
              <span className="text-ghost/70">
                BY <span className="text-bone">{contract.created_by_username}</span>
              </span>
            )}
            {isMajor && contract.org_name && contract.org_name !== '—' && (
              <span className="text-ghost/70">
                ORG <span className="text-flare/80">{contract.org_name}</span>
              </span>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="border border-ghost/20 rounded-sm px-3 py-2 text-center">
              <div className="font-mono font-bold text-lg text-ember">{contract.current_bc_value}</div>
              <div className="font-mono text-[10px] text-ghost tracking-widest">CURRENT BC</div>
            </div>
            <div className="border border-ghost/20 rounded-sm px-3 py-2 text-center">
              <div className="font-mono font-bold text-lg text-bone">{contract.base_bc_value}</div>
              <div className="font-mono text-[10px] text-ghost tracking-widest">BASE BC</div>
            </div>
            <div className="border border-ghost/20 rounded-sm px-3 py-2 text-center">
              <div className="font-mono font-bold text-lg text-bone">{contract.claim_count}</div>
              <div className="font-mono text-[10px] text-ghost tracking-widest">SOLVED</div>
            </div>
            <div className="border border-ghost/20 rounded-sm px-3 py-2 text-center">
              <div className="font-mono font-bold text-lg text-bone">{contract.intel_drop_count}</div>
              <div className="font-mono text-[10px] text-ghost tracking-widest">INTEL DROPS</div>
            </div>
          </div>

          {contract.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contract.tags.map(t => (
                <span key={t} className="font-mono text-[10px] text-ghost/60 bg-ghost/5 border border-ghost/10 rounded-sm px-2 py-0.5">{t}</span>
              ))}
            </div>
          )}

          {contract.description ? (
            <div className="border border-ghost/20 rounded-sm p-4 bg-void/50">
              <p className="font-mono text-[10px] text-ghost/50 tracking-widest mb-2">── DESCRIPTION</p>
              <div className="font-mono text-sm text-bone/80 whitespace-pre-wrap leading-relaxed">{contract.description}</div>
            </div>
          ) : (
            <div className="border border-ghost/10 rounded-sm px-4 py-3">
              <p className="font-mono text-xs text-ghost/40 tracking-widest">NO DESCRIPTION</p>
            </div>
          )}

          <div className="border border-ghost/10 bg-ghost/5 rounded-sm px-3 py-2">
            <p className="font-mono text-[10px] text-ghost/50 tracking-widest">READ-ONLY — Flag not visible here. Click outside or press ESC to close.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function BoardTab({ contracts, onView }) {
  const [filterOrg, setFilterOrg]           = useState('ALL')
  const [filterCategory, setFilterCategory] = useState('ALL')
  const [sortBy, setSortBy]                 = useState('rarity')
  const [page, setPage]                     = useState(1)

  const orgs = useMemo(() => {
    const seen = new Map()
    contracts.forEach(c => {
      if (c.org_id != null && !seen.has(c.org_id)) seen.set(c.org_id, c.org_name || '—')
    })
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  }, [contracts])

  const availableCategories = useMemo(
    () => [...new Set(contracts.map(c => c.category))].sort(),
    [contracts]
  )

  const filtered = useMemo(() => {
    let result = contracts
    if (filterOrg !== 'ALL')      result = result.filter(c => String(c.org_id) === filterOrg)
    if (filterCategory !== 'ALL') result = result.filter(c => c.category === filterCategory)
    const copy = [...result]
    switch (sortBy) {
      case 'rarity':  copy.sort((a, b) => (RARITY_TIER[a.rarity] ?? 99) - (RARITY_TIER[b.rarity] ?? 99)); break
      case 'bc_high': copy.sort((a, b) => b.base_bc_value - a.base_bc_value); break
      case 'bc_low':  copy.sort((a, b) => a.base_bc_value - b.base_bc_value); break
      case 'title':   copy.sort((a, b) => a.title.localeCompare(b.title)); break
      default: break
    }
    return copy
  }, [contracts, filterOrg, filterCategory, sortBy])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [filterOrg, filterCategory, sortBy])

  return (
    <div>
      {orgs.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setFilterOrg('ALL')}
            className={`font-mono text-[10px] px-3 py-1 rounded-sm tracking-widest border transition-all ${
              filterOrg === 'ALL'
                ? 'border-ember text-ember bg-ember/10'
                : 'border-ghost/30 text-ghost hover:border-ghost/60 hover:text-bone'
            }`}
          >
            ALL ORGS
          </button>
          {orgs.map(o => (
            <button
              key={o.id}
              onClick={() => setFilterOrg(String(o.id))}
              className={`font-mono text-[10px] px-3 py-1 rounded-sm tracking-widest border transition-all ${
                filterOrg === String(o.id)
                  ? 'border-ember text-ember bg-ember/10'
                  : 'border-ghost/30 text-ghost hover:border-ghost/60 hover:text-bone'
              }`}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-abyss border border-ghost/20 rounded-sm px-3 py-1.5 font-mono text-xs text-ghost focus:outline-none focus:border-ember"
        >
          <option value="ALL">ALL CATEGORIES</option>
          {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="bg-abyss border border-ghost/20 rounded-sm px-3 py-1.5 font-mono text-xs text-ghost focus:outline-none focus:border-ember"
        >
          <option value="rarity">SORT: RARITY</option>
          <option value="bc_high">SORT: BC HIGH→LOW</option>
          <option value="bc_low">SORT: BC LOW→HIGH</option>
          <option value="title">SORT: TITLE</option>
        </select>
        <span className="font-mono text-[10px] text-ghost/50 ml-auto">
          {filtered.length} CONTRACT{filtered.length !== 1 ? 'S' : ''}
        </span>
      </div>

      <div className="mb-5 border border-ghost/10 bg-ghost/5 rounded-sm px-3 py-2">
        <p className="font-mono text-[10px] text-ghost/50 tracking-widest">
          READ-ONLY — All published contracts in this event. Flags and editing are not available here.
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="font-mono text-xs text-ghost tracking-widest">NO PUBLISHED CONTRACTS</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginated.map(c => {
            const cfg = RARITY_CONFIG[c.rarity] || RARITY_CONFIG.COMMON
            return (
              <div
                key={c.id}
                onClick={() => onView(c)}
                className={`border ${cfg.border} bg-abyss rounded-sm p-4 flex flex-col gap-2 cursor-pointer hover:bg-ghost/5 transition-colors`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`font-mono text-sm font-bold ${cfg.text} leading-tight`}>{c.title}</span>
                  <span className={`font-mono text-[9px] tracking-widest shrink-0 ${cfg.text} opacity-60`}>{c.rarity}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] text-ghost border border-ghost/20 rounded-sm px-1.5 py-0.5">
                    {c.category}
                  </span>
                  {c.org_name && c.org_name !== '—' && (
                    <span className="font-mono text-[10px] text-flare/80 border border-flare/20 rounded-sm px-1.5 py-0.5">
                      {c.org_name}
                    </span>
                  )}
                </div>
                {c.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map(t => (
                      <span key={t} className="font-mono text-[9px] text-ghost/50 bg-ghost/5 border border-ghost/10 rounded-sm px-1">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between mt-auto pt-2 border-t border-ghost/10">
                  <span className="font-mono text-xs text-ember font-bold">{c.current_bc_value} BC</span>
                  <div className="flex items-center gap-3">
                    {c.intel_drop_count > 0 && (
                      <span className="font-mono text-[10px] text-ghost/60">{c.intel_drop_count} hints</span>
                    )}
                    <span className="font-mono text-[10px] text-ghost">{c.claim_count} solved</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="font-mono text-xs text-ghost border border-ghost/20 px-3 py-1.5 rounded-sm hover:border-ghost transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← PREV
          </button>
          <span className="font-mono text-xs text-ghost">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="font-mono text-xs text-ghost border border-ghost/20 px-3 py-1.5 rounded-sm hover:border-ghost transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            NEXT →
          </button>
        </div>
      )}
    </div>
  )
}
