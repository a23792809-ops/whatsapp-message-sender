# Bharat Gas WhatsApp Message Sender — Frontend

Next.js 16 (App Router) admin dashboard for Bharat Gas consumer notifications.

## Getting Started

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Configure environment

Copy the example environment configuration:

```bash
cp .env.example .env.local
```

Default backend API URL is `http://localhost:3001` via `NEXT_PUBLIC_API_URL`.

### 3. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the admin portal.

---

## Testing & Quality Checks

The frontend includes automated unit and component testing using [Vitest](https://vitest.dev/) and [React Testing Library](https://testing-library.com/).

```bash
# Run automated tests once
npm run test

# Run tests in watch mode during development
npm run test:watch

# Run linter
npm run lint

# Production build check
npm run build
```

### Covered Areas

- **Customer Management:** Phone number normalization (strips non-digits, leading zero, and country code), mobile validation, custom variable parsing, search/status filtering, and import validation.
- **Message Templates:** Variable extraction (`{{var}}`), substitution, missing variable detection, whitespace handling, and multi-line/Unicode preservation.
- **API & Application Behavior:** `ApiError` structure, authentication message formatting, network failure handling, and session expiration (`bg:unauthorized` event dispatch).
- **Campaign & Messaging Interface:** Progress calculation, allowed status-based actions (`start`, `pause`, `resume`, `stop`, `retry`), and message filtering.
- **UI Components:** `Badge`, `StatusBadge` (with distinct icons and colors for `READ`, `DELIVERED`, `STOPPED`, etc.), `EmptyState`, `Modal`, and `Card`.
