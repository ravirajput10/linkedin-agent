import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAdmin, RequireAnonymous, RequireAuth } from '@/auth/guards'
import { AppLayout } from '@/layouts/AppLayout'
import { Activity } from '@/pages/Activity/Activity'
import { AdminActivity } from '@/pages/Admin/Activity'
import { AdminAnalytics } from '@/pages/Admin/Analytics'
import { AdminApprovals } from '@/pages/Admin/Approvals'
import { AdminAudiences } from '@/pages/Admin/Audiences'
import { AdminCampaignDetail } from '@/pages/Admin/CampaignDetail'
import { AdminCampaigns } from '@/pages/Admin/Campaigns'
import { AdminCandidateDetail } from '@/pages/Admin/CandidateDetail'
import { AdminCandidates } from '@/pages/Admin/Candidates'
import { AdminContentStudio } from '@/pages/Admin/ContentStudio'
import { AdminCreateCampaign } from '@/pages/Admin/CreateCampaign'
import { AdminDashboard } from '@/pages/Admin/Dashboard'
import { AdminPlans } from '@/pages/Admin/Plans'
import { AdminPosts } from '@/pages/Admin/Posts'
import { AdminProfile } from '@/pages/Admin/Profile'
import { AdminScheduledActions } from '@/pages/Admin/ScheduledActions'
import { AdminSettings } from '@/pages/Admin/Settings'
import { AdminUserDetail } from '@/pages/Admin/UserDetail'
import { AdminUsers } from '@/pages/Admin/Users'
import { Analytics } from '@/pages/Analytics/Analytics'
import { Approvals } from '@/pages/Approvals/Approvals'
import { Audiences } from '@/pages/Audiences/Audiences'
import { CampaignDetail } from '@/pages/CampaignDetail/CampaignDetail'
import { Campaigns } from '@/pages/Campaigns/Campaigns'
import { CandidateDetail } from '@/pages/CandidateDetail/CandidateDetail'
import { Candidates } from '@/pages/Candidates/Candidates'
import { ContentStudio } from '@/pages/ContentStudio/ContentStudio'
import { CreateCampaign } from '@/pages/CreateCampaign/CreateCampaign'
import { Dashboard } from '@/pages/Dashboard/Dashboard'
import { Posts } from '@/pages/Posts/Posts'
import { Profile } from '@/pages/Profile/Profile'
import { Register } from '@/pages/Register/Register'
import { VerifyEmail } from '@/pages/Register/VerifyEmail'
import { ScheduledActions } from '@/pages/ScheduledActions/ScheduledActions'
import { Settings } from '@/pages/Settings/Settings'
import { OAuthCallback } from '@/pages/OAuthCallback/OAuthCallback'
import { SignInWizard } from '@/pages/SignInWizard/SignInWizard'
import { Landing } from '@/pages/Landing/Landing'

export function App() {
  return (
    <Routes>
      {/* Public Landing Page */}
      <Route path="/" element={<Landing />} />
      <Route path="/landing" element={<Landing />} />

      {/* Signed-out screens: no shell, no navigation. */}
      <Route element={<RequireAnonymous />}>
        <Route path="/register" element={<Register />} />
      </Route>
      {/* Sign-in and onboarding wizard */}
      <Route path="/login" element={<SignInWizard />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          {/* User Workspace Routes */}
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="audiences" element={<Audiences />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/new" element={<CreateCampaign />} />
          <Route path="campaigns/:id" element={<CampaignDetail />} />
          <Route path="content-studio" element={<ContentStudio />} />
          <Route path="candidates" element={<Candidates />} />
          <Route path="candidates/:id" element={<CandidateDetail />} />
          <Route path="posts" element={<Posts />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="scheduled-actions" element={<ScheduledActions />} />
          <Route path="activity" element={<Activity />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<Settings />} />
          <Route path="profile" element={<Profile />} />

          {/* Admin Dedicated Routes */}
          <Route path="admin" element={<RequireAdmin />}>
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="audiences" element={<AdminAudiences />} />
            <Route path="campaigns" element={<AdminCampaigns />} />
            <Route path="campaigns/new" element={<AdminCreateCampaign />} />
            <Route path="campaigns/:id" element={<AdminCampaignDetail />} />
            <Route path="content-studio" element={<AdminContentStudio />} />
            <Route path="candidates" element={<AdminCandidates />} />
            <Route path="candidates/:id" element={<AdminCandidateDetail />} />
            <Route path="posts" element={<AdminPosts />} />
            <Route path="approvals" element={<AdminApprovals />} />
            <Route path="scheduled-actions" element={<AdminScheduledActions />} />
            <Route path="activity" element={<AdminActivity />} />
            <Route path="analytics" element={<AdminAnalytics />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/:id" element={<AdminUserDetail />} />
            <Route path="plans" element={<AdminPlans />} />
            <Route path="profile" element={<AdminProfile />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
