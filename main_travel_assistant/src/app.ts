import express from 'express';

// Core
import { registerIntent } from './core/pipeline';

// Intent handlers
import { handlePlaceInfo } from './intents/placeInfo';
import { handleTicketPrice } from './intents/ticketPrice';
import { handleOpeningHours } from './intents/openingHours';
import { handleWeather } from './intents/weather';
import { handleNearby } from './intents/nearby';
import { handleDirections } from './intents/directions';
import { handleTour } from './intents/tour';
import { handleDiscover } from './intents/discover';
import { handleFallback } from './intents/fallback';

// Routes & middlewares
import telegramRoute from './routes/telegram.route';
import { requestContextMiddleware } from './middlewares/requestContext';
import { errorMiddleware } from './middlewares/errorHandler';

// ── Register all intent handlers ──
registerIntent('GET_PLACE_INFO', handlePlaceInfo);
registerIntent('GET_OPENING_HOURS', handleOpeningHours);
registerIntent('GET_TICKET_PRICE', handleTicketPrice);
registerIntent('GET_WEATHER', handleWeather);
registerIntent('SEARCH_NEARBY', handleNearby);
registerIntent('GET_DIRECTIONS', handleDirections);
registerIntent('SEARCH_TOUR', handleTour);
registerIntent('DISCOVER_LOCATION', handleDiscover);
registerIntent('UNKNOWN', handleFallback);

// ── Express app ──
const app = express();
app.use(express.json());
app.use(requestContextMiddleware);

// Routes
app.use(telegramRoute);
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Global error handler
app.use(errorMiddleware);

export default app;
