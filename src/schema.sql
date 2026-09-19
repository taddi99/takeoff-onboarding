CREATE USER IF NOT EXISTS 'takeoff_user'@'localhost'IDENTIFIED BY 'Tadiwa@2003' ;
CREATE USER IF NOT EXISTS 'takeoff_user'@'127.0.0.1' IDENTIFIED BY 'Tadiwa@2003' ;
GRANT ALL PRIVILEGES ON takeoff_onboarding.* TO 'takeoff_user'@'localhost';
GRANT ALL PRIVILEGES ON takeoff_onboarding.* TO 'takeoff_user'@'127.0.0.1' ;
FLUSH PRIVILEGES ;