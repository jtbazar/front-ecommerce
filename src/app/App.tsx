import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { CartProvider } from '../contexts/CartContext'
import { CatalogProvider } from '../contexts/CatalogContext'
import { AuthProvider } from '../contexts/AuthContext'
import { MfaGate } from '../components/auth/MfaGate'
import { WishlistProvider } from '../contexts/WishlistContext'
import { ToastProvider } from '../contexts/ToastContext'
import { LocaleProvider, useI18n } from '../i18n/LocaleContext'
import { SiteHeader } from '../components/layout/SiteHeader'
import { SiteFooter } from '../components/layout/SiteFooter'
import { MobileBottomNavigation } from '../components/navigation/MobileBottomNavigation'
import { HomePage } from '../pages/HomePage'
import { ShopPage, CategoriesPage, CategoryPage, SearchPage } from '../pages/ShopPages'
import { DiscoverPage } from '../pages/DiscoverPage'
import { BudgetPage } from '../pages/BudgetPage'
import { PublicShopPage } from '../pages/PublicShopPage'
import { ProductPage } from '../pages/ProductPage'
import { WishlistPage } from '../pages/WishlistPage'
import { CartPage } from '../pages/CartPage'
import { CheckoutPage } from '../pages/CheckoutPage'
import { ConfirmationPage } from '../pages/ConfirmationPage'
import { AboutPage, ContactPage, FAQPage, PrivacyPage, ShippingPage, ReturnsPage, TermsPage } from '../pages/InfoPages'
import { LoginPage, RegisterPage, ForgotPasswordPage, VerifyEmailPage, VerifyOtpPage, ResetPasswordPage, AuthCallbackPage, LogoutPage } from '../pages/AuthPages'
import { AccountPage } from '../pages/AccountPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { VendorApplicationPage, VendorDashboardPage } from '../pages/VendorPages'
import { DeleteAccountPage } from '../pages/DeleteAccountPage'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [pathname])
  return null
}

function SplashScreen() {
  return <div className="app-splash" role="status" aria-label="Loading JTBazar">
    <img src="/jtbazar-logo.webp" alt="JTBazar" />
    <span>Pakistan's marketplace</span>
  </div>
}

function hasAcceptedSignInMethod(session: { access_token: string } | null) {
  if (!session?.access_token) return false
  try {
    const segment = session.access_token.split('.')[1]
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=')
    const claims = JSON.parse(atob(normalized)) as { amr?: Array<{ method?: string }> }
    // Password sign-in must complete email OTP. Google OAuth is already
    // authenticated by Google and must not be discarded by the OTP-only guard.
    return Array.isArray(claims.amr) && claims.amr.some((entry) =>
      entry.method === 'otp' || entry.method === 'oauth'
    )
  } catch {
    return false
  }
}

function Storefront() {
  const { t, locale, direction } = useI18n()
  const { session, signOut } = useAuth()
  const location = useLocation()
  const acceptedSignInMethod = hasAcceptedSignInMethod(session)
  const passwordRecoveryPath = location.pathname === '/reset-password'
  const authCallbackPath = location.pathname === '/auth/callback'
  const [showSplash, setShowSplash] = useState(true)
  useEffect(() => {
    if (session && !acceptedSignInMethod && !passwordRecoveryPath && !authCallbackPath) {
      void signOut()
    }
  }, [session?.access_token, acceptedSignInMethod, passwordRecoveryPath, authCallbackPath, signOut])
  useEffect(() => {
    const timeout = window.setTimeout(() => setShowSplash(false), 950)
    return () => window.clearTimeout(timeout)
  }, [])
  if (session && !acceptedSignInMethod && !passwordRecoveryPath && !authCallbackPath) return <SplashScreen />
  return <>
  <div className="app-shell" lang={locale} dir={direction}>
    <a className="skip-link" href="#main-content">{t('Skip to content')}</a>
    <SiteHeader />
    <main id="main-content" className="main-content">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/shops/:slug" element={<PublicShopPage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/categories/:slug" element={<CategoryPage />} />
        <Route path="/products/:slug" element={<ProductPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/wishlist" element={<WishlistPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-confirmation/:orderNumber" element={<ConfirmationPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/vendor/apply" element={<VendorApplicationPage />} />
        <Route path="/vendor" element={<VendorDashboardPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/verify-otp" element={<VerifyOtpPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/logout" element={<LogoutPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/delete-account" element={<DeleteAccountPage />} />
        <Route path="/shipping" element={<ShippingPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </main>
    <SiteFooter />
    <MobileBottomNavigation />
    <ScrollToTop />
  </div>
  {showSplash && <SplashScreen />}
  </>
}

export function App() {
  return <BrowserRouter><LocaleProvider><ToastProvider><CatalogProvider><AuthProvider><MfaGate><CartProvider><WishlistProvider><Storefront /></WishlistProvider></CartProvider></MfaGate></AuthProvider></CatalogProvider></ToastProvider></LocaleProvider></BrowserRouter>
}
