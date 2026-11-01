import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './App';
import { AuthProvider, createQueryClient } from './auth';
import { NotificationProvider } from './components/Notifications';
import './index.css';

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationProvider>
          <RouterProvider router={router} />
        </NotificationProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
