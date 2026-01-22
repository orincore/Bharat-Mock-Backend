# Bharat Mock Backend API

Backend API for Bharat Mock - Online Exam & Education Platform

## Tech Stack

- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Database**: PostgreSQL (via Supabase)
- **Storage**: Cloudflare R2
- **Authentication**: JWT

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `JWT_SECRET` - Secret key for JWT tokens
- `R2_ACCOUNT_ID` - Cloudflare R2 account ID
- `R2_ACCESS_KEY_ID` - R2 access key
- `R2_SECRET_ACCESS_KEY` - R2 secret key
- `R2_BUCKET_NAME` - R2 bucket name

### 3. Database Setup

Run the SQL schema in your Supabase SQL editor:

```bash
# Copy the contents of schema.sql and run in Supabase SQL Editor
```

### 4. Start Development Server

```bash
npm run dev
```

The API will be available at `http://localhost:5000`

### 5. Production Build

```bash
npm start
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - User login
- `GET /api/v1/auth/profile` - Get user profile (authenticated)
- `PUT /api/v1/auth/profile` - Update profile (authenticated)
- `POST /api/v1/auth/forgot-password` - Request password reset
- `POST /api/v1/auth/reset-password` - Reset password
- `POST /api/v1/auth/change-password` - Change password (authenticated)

### Exams
- `GET /api/v1/exams` - List all exams (with filters)
- `GET /api/v1/exams/categories` - Get exam categories
- `GET /api/v1/exams/:id` - Get exam details
- `POST /api/v1/exams/:examId/start` - Start exam (authenticated)
- `GET /api/v1/exams/:examId/attempts/:attemptId/questions` - Get exam questions (authenticated)
- `POST /api/v1/exams/:attemptId/questions/:questionId/answer` - Save answer (authenticated)
- `POST /api/v1/exams/:attemptId/submit` - Submit exam (authenticated)

### Results
- `GET /api/v1/results` - Get user results (authenticated)
- `GET /api/v1/results/:id` - Get result details (authenticated)
- `GET /api/v1/results/:resultId/review` - Get answer review (authenticated)

### Colleges
- `GET /api/v1/colleges` - List colleges (with filters)
- `GET /api/v1/colleges/:id` - Get college details

### Courses
- `GET /api/v1/courses` - List courses (with filters)
- `GET /api/v1/courses/:id` - Get course details

### Articles
- `GET /api/v1/articles` - List articles (with filters)
- `GET /api/v1/articles/categories` - Get article categories
- `GET /api/v1/articles/tags` - Get popular tags
- `GET /api/v1/articles/:slug` - Get article by slug

## Security Features

- Helmet.js for security headers
- CORS protection
- Rate limiting
- Input validation with express-validator
- JWT authentication
- Password hashing with bcrypt
- SQL injection protection via Supabase

## Error Handling

All API responses follow this format:

**Success Response:**
```json
{
  "success": true,
  "data": {},
  "message": "Optional message"
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "Error message",
  "errors": []
}
```

## Testing

```bash
npm test
```

## Linting

```bash
npm run lint
```

## Project Structure

```
src/
├── config/          # Configuration files
│   ├── database.js  # Supabase client
│   ├── r2.js        # R2 storage config
│   └── logger.js    # Winston logger
├── controllers/     # Route controllers
├── middleware/      # Express middleware
├── routes/          # API routes
├── utils/           # Utility functions
└── server.js        # Main server file
```

## License

MIT
