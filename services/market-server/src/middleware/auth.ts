// Supabase Auth Middleware — verifies JWT from Authorization header
import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
    };
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Local-dev/test bypass: ONLY when the server is launched with
    // DEV_AUTH_BYPASS=1 (never set in any deploy config). Lets the offline
    // eval harness exercise authed routes without a live Supabase session.
    if (process.env.DEV_AUTH_BYPASS === '1') {
        req.user = { id: 'dev-bypass', email: 'dev@localhost' };
        next();
        return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing authorization token' });
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        req.user = {
            id: user.id,
            email: user.email || '',
        };

        next();
    } catch {
        res.status(401).json({ error: 'Authentication failed' });
    }
};
