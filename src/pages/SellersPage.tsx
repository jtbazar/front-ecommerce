import { ArrowRight, MapPin, Search, Store } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState, LoadingState } from '../components/common/States'
import { useCatalog } from '../contexts/CatalogContext'
import { usePageMeta } from '../hooks/usePageMeta'
import { useI18n } from '../i18n/LocaleContext'

export function SellersPage() {
  const { t } = useI18n()
  const { shops, status, error } = useCatalog()
  const [query, setQuery] = useState('')
  const sellers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return shops.filter((shop) => !normalized || `${shop.shopName} ${shop.shopLocationLabel ?? ''} ${shop.description}`.toLocaleLowerCase().includes(normalized))
  }, [shops, query])
  usePageMeta(t('Independent sellers'), t('Explore every independent seller and public shop on JTBazar.'))

  return <div className="page-shell sellers-directory">
    <header className="sellers-directory__hero">
      <span className="eyebrow">{t('Independent sellers')}</span>
      <h1>{t('Meet the sellers behind')} <em>{t('JTBazar.')}</em></h1>
      <p>{t('Browse trusted independent shops, discover their collections and find your next favourite.')}</p>
      <label className="sellers-directory__search"><Search size={18} aria-hidden="true" /><span className="sr-only">{t('Search sellers')}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search by shop name or location')} /></label>
    </header>
    {status === 'loading' && <LoadingState label="Loading independent sellers…" />}
    {status === 'error' && <ErrorState message={error || 'The seller directory could not be loaded.'} />}
    {status === 'ready' && <>
      <div className="sellers-directory__meta"><strong>{sellers.length} {t(sellers.length === 1 ? 'seller' : 'sellers')}</strong><span>{t('Public shops currently on JTBazar')}</span></div>
      {sellers.length ? <div className="sellers-directory__grid">{sellers.map((shop) => <Link className="seller-directory-card" to={`/shops/${shop.slug}`} key={shop.id}>
        <span className="seller-directory-card__image">{shop.shopImageUrl ? <img src={shop.shopImageUrl} alt="" loading="lazy" /> : <Store size={30} aria-hidden="true" />}</span>
        <span className="seller-directory-card__body"><small><Store size={13} aria-hidden="true" /> {t('Verified shop')}</small><strong>{t(shop.shopName)}</strong><span>{shop.shopLocationLabel ? <><MapPin size={13} aria-hidden="true" /> {t(shop.shopLocationLabel)}</> : t('Online shop')}</span><span>{shop.productCount} {t('products')}</span><b>{t('Visit shop')} <ArrowRight size={15} aria-hidden="true" /></b></span>
      </Link>)}</div> : <div className="sellers-directory__empty"><Store size={28} /><h2>{t('No sellers found')}</h2><p>{t('Try another shop name or location.')}</p></div>}
    </>}
  </div>
}
