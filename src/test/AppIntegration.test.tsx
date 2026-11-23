import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { AppProvider } from '../context/AppContext';
import App from '../App';

describe('LabLink React UI & Integration Workflows', () => {
  it('renders landing page hero title and navigation bar', () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>
    );

    expect(screen.getByText(/Your Campus Labs/i)).not.toBeNull();
    expect(screen.getByText(/One Connected Platform/i)).not.toBeNull();
    expect(screen.getByText(/Explore Resources/i)).not.toBeNull();
  });

  it('switches navigation view when clicking Explore Labs', async () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>
    );

    const exploreBtn = screen.getByRole('button', { name: /Explore Labs/i });
    fireEvent.click(exploreBtn);

    expect(screen.getByText(/Laboratory Equipment Marketplace/i)).not.toBeNull();
    expect(screen.getByPlaceholderText(/Search by instrument name/i)).not.toBeNull();
  });

  it('navigates to AI Conflict Resolver and shows contested scenario', async () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>
    );

    const resolverBtn = screen.getByRole('button', { name: /AI Conflict Resolver/i });
    fireEvent.click(resolverBtn);

    expect(screen.getByText(/LabLink AI Conflict Resolver/i)).not.toBeNull();
    expect(screen.getByText(/Contested Resource/i)).not.toBeNull();
  });

  it('switches demo roles between Student, Faculty, and Admin in navbar', async () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>
    );

    // Switch to Faculty
    const facultyBtn = screen.getByRole('button', { name: /faculty/i });
    fireEvent.click(facultyBtn);

    const dashboardNavBtn = screen.getByRole('button', { name: /Dashboard/i });
    fireEvent.click(dashboardNavBtn);

    expect(screen.getByText(/Faculty Laboratory Review Portal/i)).not.toBeNull();

    // Switch to Admin
    const adminBtn = screen.getByRole('button', { name: /admin/i });
    fireEvent.click(adminBtn);

    expect(screen.getByText(/Laboratory Administrator Control Center/i)).not.toBeNull();
  });
});
