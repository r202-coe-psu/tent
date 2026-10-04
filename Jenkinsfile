pipeline {
    agent { label 'mgmt' }

    stages {
        stage('Deploy to Staging Server') {
            when {
                branch 'staging'
            }
            steps {
                script {
                    if (!(env.GIT_COMMIT ==~ /[0-9a-f]{40}/)) {
                        error("Invalid build commit: ${env.GIT_COMMIT}")
                    }
                }
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-staging-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-staging-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-staging-port', variable: 'SSH_PORT')
                ]) {
                    // Deploy the exact commit Jenkins built (not `git pull`), and fail fast on any
                    // remote error so a stale checkout can never be reported as a successful deploy.
                    withEnv(["DEPLOY_SHA=${env.GIT_COMMIT}"]) {
                        sh '''
                            set -eu
                            echo "Starting deployment of ${DEPLOY_SHA} to Staging server..."

                            ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" "
                                set -eu
                                echo '==> Deploying Tent ${DEPLOY_SHA} to Staging...'
                                cd /home/projects/tent
                                git fetch --no-tags origin +refs/heads/staging:refs/remotes/origin/staging
                                git checkout -B staging ${DEPLOY_SHA}

                                echo '==> Building frontend image...'
                                docker compose -f docker-compose.staging.no-nginx.yml build frontend

                                echo '==> Syncing CouchDB Design Docs & Schema...'
                                docker compose -f docker-compose.staging.no-nginx.yml run --rm frontend pnpm db:sync

                                echo '==> Starting services...'
                                docker compose -f docker-compose.staging.no-nginx.yml up -d --build --force-recreate
                            "
                            echo "Deployment process finished successfully!"
                        '''
                    }
                }
            }
        }

        stage('Trigger Staging E2E') {
            when {
                branch 'staging'
            }
            steps {
                catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE', message: 'Unable to enqueue Staging E2E') {
                    withCredentials([
                        sshUserPrivateKey(credentialsId: 'tent-staging-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                        string(credentialsId: 'tent-staging-host', variable: 'SSH_HOST'),
                        string(credentialsId: 'tent-staging-port', variable: 'SSH_PORT')
                    ]) {
                        script {
                            def deployedCommit = sh(
                                returnStdout: true,
                                script: '''
                                    set +x
                                    ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
                                        "git -C /home/projects/tent rev-parse HEAD"
                                '''
                            ).trim()

                            if (deployedCommit != env.GIT_COMMIT) {
                                error("Staging server is at ${deployedCommit}, expected ${env.GIT_COMMIT}")
                            }

                            echo "Queueing tent-e2e-staging for ${deployedCommit}"
                            build job: 'tent-e2e-staging',
                                  parameters: [
                                      string(name: 'DEPLOY_COMMIT', value: deployedCommit),
                                      string(name: 'STAGING_URL', value: 'https://shelter.importstar.dev')
                                  ],
                                  wait: false,
                                  propagate: false
                        }
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                script {
                    if (!(env.GIT_COMMIT ==~ /[0-9a-f]{40}/)) {
                        error("Invalid build commit: ${env.GIT_COMMIT}")
                    }
                }
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-prod-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-prod-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-prod-port', variable: 'SSH_PORT')
                ]) {
                    withEnv(["DEPLOY_SHA=${env.GIT_COMMIT}"]) {
                        sh '''
                            set -eu
                            echo "Starting deployment of ${DEPLOY_SHA} to Production server..."

                            ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" "
                                set -eu
                                echo '==> Deploying Tent ${DEPLOY_SHA} to Production...'
                                cd /home/projects/tent
                                git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
                                git checkout -B main ${DEPLOY_SHA}

                                echo '==> Building frontend image...'
                                docker compose -f docker-compose.production.no-nginx.yml build frontend

                                echo '==> Syncing CouchDB Design Docs & Schema...'
                                docker compose -f docker-compose.production.no-nginx.yml run --rm frontend pnpm db:sync

                                echo '==> Starting services...'
                                docker compose -f docker-compose.production.no-nginx.yml up -d --build --force-recreate
                            "
                            echo "Deployment process finished successfully!"
                        '''
                    }
                }
            }
        }
    }

    post {
        always {
            cleanWs(cleanWhenNotBuilt: false,
                    deleteDirs: true,
                    disableDeferredWipeout: true,
                    notFailBuild: true)
        }
    }
}
