import express from 'express';

// Used to validate any params recieved from client
import { check, validationResult } from 'express-validator';

// A poll of connections to MySQL database used to make queries
import MySQLPool from 'Loaders/mysql';

// Import Winston logger instance to log messages to console
import Logger from 'Loaders/logger';

const userRouter = express.Router();

// Function used to format validation errors (if any)
const validationErrorFormatter = ({ msg }) => {
  return msg;
};

// Custome validator to availabilty length
const isLength = (value) => {
  if (value === undefined || value === null) return false;
  if (value.length !== 7) return false;
  else return true;
};

export default (baseRouter) => {
  baseRouter.use('/', userRouter);

  // POST route used when a new user wants to create an account
  userRouter.post(
    '/join',
    [
      // Check that first name is not empty
      check('first_name').not().isEmpty().withMessage('First name can not be empty'),
      // Check that the first name only contains alphabets
      check('first_name')
        .isAlpha()
        .withMessage('First name can only contain letters (a-zA-Z)'),
      // Check that last name is not empty
      check('last_name').not().isEmpty().withMessage('Last name can not be empty'),
      // Check that last name only contains alphabets
      check('last_name')
        .isAlpha()
        .withMessage('Last name can only contain letters (a-zA-Z)'),
      // Check that username is of valid length
      check('username')
        .isLength({ min: 5, max: 30 })
        .withMessage('Username size needs to be between 5 and 30'),
      // Check that password is a valid hash
      check('pass').isMD5().withMessage('Chosen password is weak'),
      // Check that email is valid
      check('email').isEmail().withMessage('Provide a valid email address'),
      // Check that account type is a valid enum
      check('account_type')
        .isInt({ min: 0, max: 1 })
        .withMessage('Account type is not a valid type'),
    ],
    async (req, res) => {
      let session = req.session;

      if (session.isUserLoggedIn === true) {
        // A way to redirect when using XHTTP
        res.setHeader('xhttp-redirect', '/scheduler');
        res.sendStatus(200);
      } else {
        const validationErrors = validationResult(req).formatWith(
          validationErrorFormatter,
        );

        if (validationErrors.isEmpty() === false) {
          res.status(422).json({ errors: validationErrors.array() });
        } else {
          let userID = undefined;

          try {
            // If account being created is for a manager
            if (req.body.account_type === 0) {
              const [rows] = await MySQLPool.query('CALL NewManager(?,?,?,?,?)', [
                req.body.first_name,
                req.body.last_name,
                req.body.email,
                req.body.username,
                req.body.pass,
              ]);

              userID = rows[0][0].manager_id;
            } else if (req.body.account_type === 1) {
              // If account being created is for a worker
              const [rows] = await MySQLPool.query('CALL NewWorker(?,?,?,?,?)', [
                req.body.first_name,
                req.body.last_name,
                req.body.email,
                req.body.username,
                req.body.pass,
              ]);

              userID = rows[0][0].worker_id;
            }

            // Something has gone wrong and there is no user id
            if (userID == undefined) {
              Logger.error('No user id returned when creating a new user');
              res.status(500).json({ error: 'Internal server error occured' });
            } else {
              // Store user information in session
              session.isUserLoggedIn = true;
              session.userID = userID;
              session.userType = req.body.account_type;

              // A way to redirect when using XHTTP
              res.setHeader('xhttp-redirect', '/scheduler');
              res.sendStatus(200);
            }
          } catch (error) {
            // Check what type of error occured
            if (error.code === 'ER_DUP_ENTRY') {
              // Only a dublicate username can cause this MySQL error
              Logger.warn(error);
              res.status(422).json({ errors: ['Username already exists'] });
            } else {
              // Any other error is bad news
              Logger.error(error);
              res.status(500).json({ error: 'Internal server error occured' });
            }
          }
        }
      }
    },
  );

  // POST route used when a user wants to login
  userRouter.post(
    '/login',
    [
      // Check that username is of valid length
      check('username').isLength({ min: 5, max: 30 }),
      // Check that password is a valid hash
      check('pass').isMD5(),
      // Check that account type is a valid enum
      check('account_type').isInt({ min: 0, max: 1 }),
    ],
    async (req, res) => {
      let session = req.session;

      if (session.isUserLoggedIn === true) {
        // A way to redirect when using XHTTP
        res.setHeader('xhttp-redirect', '/scheduler');
        res.sendStatus(200);
      } else {
        const validationErrors = validationResult(req).formatWith(
          validationErrorFormatter,
        );

        if (validationErrors.isEmpty() === false) {
          res.status(401).json({ error: 'Invalid account information' });
        } else {
          let userID = undefined;
          let workspaceID = undefined;

          try {
            const [rows] = await MySQLPool.query('CALL CheckUserExists(?,?,?)', [
              req.body.username,
              req.body.pass,
              req.body.account_type,
            ]);

            if (rows[0].length === 1) {
              if (req.body.account_type === 0) userID = rows[0][0].manager_id;
              else if (req.body.account_type === 1) userID = rows[0][0].worker_id;

              // Get workspaces manager belongs to
              const [
                workspace_rows,
              ] = await MySQLPool.query('CALL GetUserWorkspaces(?,?)', [
                userID,
                req.body.account_type,
              ]);

              // Check if there are any workspaces at all
              if (workspace_rows[0].length > 0) {
                workspaceID = workspace_rows[0][0].workspace_id;
              }
            }

            // No account with matching details found
            if (userID == undefined) {
              res.status(401).json({ error: 'Account does not exist' });
            } else {
              // Store user information in session
              session.isUserLoggedIn = true;
              session.userID = userID;
              session.userType = req.body.account_type;
              session.workspaceID = workspaceID;

              // A way to redirect when using XHTTP
              res.setHeader('xhttp-redirect', '/scheduler');
              res.sendStatus(200);
            }
          } catch (error) {
            Logger.error(error);
            res.status(500).json({ error: 'Internal server error occured' });
          }
        }
      }
    },
  );

  // POST route used when a user wants to logout
  userRouter.post('/logout', async (req, res) => {
    let session = req.session;

    session.destroy((error) => {
      // Check if any error occured
      if (error !== undefined) {
        Logger.error(error);
        res.status(500).json({ success: false, error: 'Internal server error occured' });
      } else {
        // Redirect to home
        res.setHeader('xhttp-redirect', '/');
        res.sendStatus(200);
      }
    });
  });

  // GET route used to retrieve current user id
  userRouter.get('/user/id', async (req, res) => {
    let session = req.session;

    if (session.isUserLoggedIn === true) {
      res.json({ user_id: session.userID });
    } else {
      res.sendStatus(401);
    }
  });

  // GET route used to retrieve user profile
  userRouter.get('/profile', async (req, res) => {
    let session = req.session;

    if (session.isUserLoggedIn === true) {
      try {
        const [rows] = await MySQLPool.query('CALL GetProfileInformation(?,?)', [
          session.userType,
          session.userID,
        ]);

        res.json({ profile: rows[0][0] });
      } catch (error) {
        Logger.error(error);
        res.status(500).json({ error: 'Internal server error occured' });
      }
    } else {
      res.sendStatus(401);
    }
  });

  // GET route used to retrieve user profile
  userRouter.put(
    '/profile',
    [
      // Check that first name is not empty
      check('first_name').not().isEmpty().withMessage('First name can not be empty'),
      // Check that the first name only contains alphabets
      check('first_name')
        .isAlpha()
        .withMessage('First name can only contain letters (a-zA-Z)'),
      // Check that last name is not empty
      check('last_name').not().isEmpty().withMessage('Last name can not be empty'),
      // Check that last name only contains alphabets
      check('last_name')
        .isAlpha()
        .withMessage('Last name can only contain letters (a-zA-Z)'),
      // Check that username is of valid length
      check('username')
        .isLength({ min: 5, max: 30 })
        .withMessage('Username size needs to be between 5 and 30'),
      // Check that password is a valid hash
      check('pass').isMD5().withMessage('Chosen password is weak'),
      // Check that email is valid
      check('email').isEmail().withMessage('Provide a valid email address'),
      // Check that availability is not empty
      check('availability')
        .custom(isLength, 7)
        .withMessage('Availability is not in a valid format'),
    ],
    async (req, res) => {
      let session = req.session;

      if (session.isUserLoggedIn === true) {
        const validationErrors = validationResult(req).formatWith(
          validationErrorFormatter,
        );

        if (validationErrors.isEmpty() === false) {
          res.status(422).json({ errors: validationErrors.array() });
        } else {
          try {
            const [
              rows,
            ] = await MySQLPool.query('CALL UpdateUserProfile(?,?,?,?,?,?,?,?)', [
              session.userID,
              session.userType,
              req.body.first_name,
              req.body.last_name,
              req.body.email,
              req.body.username,
              req.body.pass,
              req.body.availability,
            ]);

            res.sendStatus(200);
          } catch (error) {
            Logger.error(error);
            res.status(500).json({ error: 'Internal server error occured' });
          }
        }
      } else {
        res.sendStatus(401);
      }
    },
  );
};
