import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/store/auth';
import { Spinner, ToastProvider } from '@/components/ui';
import { RequireRole } from '@/components/RequireRole';
import { LandingPage } from '@/pages/LandingPage';
import { SignInPage } from '@/pages/auth/SignInPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/* Guest routes load eagerly: a diner at a table should not wait on a second
   round trip after scanning. The dashboards are code-split, since no guest
   ever loads them. */
import { GuestShell } from '@/pages/customer/GuestShell';
import { MenuPage } from '@/pages/customer/MenuPage';
import { CartPage } from '@/pages/customer/CartPage';
import { OrdersPage } from '@/pages/customer/OrdersPage';
import { MorePage } from '@/pages/customer/MorePage';
import { GamesPage } from '@/pages/customer/GamesPage';
import { LoyaltyPage } from '@/pages/customer/LoyaltyPage';
import { ReviewPage } from '@/pages/customer/ReviewPage';

const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const AdminOverview = lazy(() => import('@/pages/admin/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const AdminOrders = lazy(() => import('@/pages/admin/OrdersAdminPage').then((m) => ({ default: m.OrdersAdminPage })));
const AdminMenu = lazy(() => import('@/pages/admin/MenuAdminPage').then((m) => ({ default: m.MenuAdminPage })));
const AdminCategories = lazy(() => import('@/pages/admin/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const AdminTables = lazy(() => import('@/pages/admin/TablesPage').then((m) => ({ default: m.TablesPage })));
const AdminStaff = lazy(() => import('@/pages/admin/StaffPage').then((m) => ({ default: m.StaffPage })));
const AdminMarketing = lazy(() => import('@/pages/admin/MarketingPage').then((m) => ({ default: m.MarketingPage })));
const AdminGames = lazy(() => import('@/pages/admin/GamesAdminPage').then((m) => ({ default: m.GamesAdminPage })));
const AdminLoyalty = lazy(() => import('@/pages/admin/LoyaltyAdminPage').then((m) => ({ default: m.LoyaltyAdminPage })));
const AdminReviews = lazy(() => import('@/pages/admin/ReviewsAdminPage').then((m) => ({ default: m.ReviewsAdminPage })));
const AdminReports = lazy(() => import('@/pages/admin/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const AdminSettings = lazy(() => import('@/pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));

const WaiterBoard = lazy(() => import('@/pages/staff/WaiterBoard').then((m) => ({ default: m.WaiterBoard })));
const KitchenBoard = lazy(() => import('@/pages/staff/KitchenBoard').then((m) => ({ default: m.KitchenBoard })));

const PlatformLayout = lazy(() => import('@/pages/super/PlatformLayout').then((m) => ({ default: m.PlatformLayout })));
const PlatformOverview = lazy(() => import('@/pages/super/PlatformOverview').then((m) => ({ default: m.PlatformOverview })));
const PlatformRestaurants = lazy(() => import('@/pages/super/RestaurantsPage').then((m) => ({ default: m.RestaurantsPage })));
const PlatformPlans = lazy(() => import('@/pages/super/PlansPage').then((m) => ({ default: m.PlansPage })));
const PlatformSubscriptions = lazy(() => import('@/pages/super/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })));

function Loading() {
  return (
    <div className="min-h-dvh grid place-items-center bg-ink-50">
      <Spinner size={28} className="text-brand-600" />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/signin" element={<SignInPage />} />

              {/* ---- guest: the QR / NFC destination ---- */}
              <Route path="/r/:slug/t/:code" element={<GuestShell />}>
                <Route index element={<MenuPage />} />
                <Route path="cart" element={<CartPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="more" element={<MorePage />} />
                <Route path="games" element={<GamesPage />} />
                <Route path="loyalty" element={<LoyaltyPage />} />
                <Route path="review" element={<ReviewPage />} />
              </Route>

              {/* a bare /r/:slug has no table, so it cannot take an order */}
              <Route path="/r/:slug" element={<GuestShell />} />

              {/* ---- restaurant admin ---- */}
              <Route
                path="/admin"
                element={
                  <RequireRole roles={['restaurant_admin', 'manager']}>
                    <AdminLayout />
                  </RequireRole>
                }
              >
                <Route index element={<AdminOverview />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="menu" element={<AdminMenu />} />
                <Route path="categories" element={<AdminCategories />} />
                <Route path="tables" element={<AdminTables />} />
                <Route path="staff" element={<AdminStaff />} />
                <Route path="marketing" element={<AdminMarketing />} />
                <Route path="games" element={<AdminGames />} />
                <Route path="loyalty" element={<AdminLoyalty />} />
                <Route path="reviews" element={<AdminReviews />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="settings" element={<AdminSettings />} />
              </Route>

              {/* ---- floor staff ---- */}
              <Route
                path="/waiter"
                element={
                  <RequireRole roles={['waiter', 'cashier', 'manager', 'restaurant_admin']}>
                    <WaiterBoard />
                  </RequireRole>
                }
              />
              <Route
                path="/kitchen"
                element={
                  <RequireRole roles={['kitchen', 'manager', 'restaurant_admin']}>
                    <KitchenBoard />
                  </RequireRole>
                }
              />

              {/* ---- platform ---- */}
              <Route
                path="/platform"
                element={
                  <RequireRole roles={['super_admin']}>
                    <PlatformLayout />
                  </RequireRole>
                }
              >
                <Route index element={<PlatformOverview />} />
                <Route path="restaurants" element={<PlatformRestaurants />} />
                <Route path="plans" element={<PlatformPlans />} />
                <Route path="subscriptions" element={<PlatformSubscriptions />} />
              </Route>

              <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
